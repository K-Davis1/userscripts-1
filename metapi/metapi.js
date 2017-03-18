/* eslint-disable camelcase */ // Don't throw warnings for names like `error_name`.
/* global ReconnectingWebSocket */

window.metapi = {};

(function () {
  "use strict";

  // Private: Dictionary of API keys to metapi.WebSockets
  var sockets = {};
  var pendingSockets = [];

  // Private: Dictionary of MS database field names to bitstring indexes
  var api_field_mappings = {};
  $.ajax({
    type: 'GET',
    url: 'https://metasmoke.erwaysoftware.com/api/filter_fields'
  })
  .done(function (data) {
    api_field_mappings = data;
  })
  .error(function (jqXhr) {
    api_field_mappings = null;
    console.error("Failed to fetch API field mappings from MS API:", jqXhr);
  });

  $.getScript("https://raw.githubusercontent.com/joewalnes/reconnecting-websocket/f8055b77ba75e5d564ffb50d20a483bdd7edccdf/reconnecting-websocket.min.js",
    metapi.watchPendingSockets);

  // Public: Enable debug mode by setting this to true. Calls to metapi.debug will log output.
  metapi.debugMode = false;

  /**
   * If debug mode is enabled, print a message to the console.
   *
   * @param obj a message or object to print to the console
   */
  metapi.debug = function (obj) {
    if (metapi.debugMode) {
      console.log(obj);
    }
  };

  /**
   * A simple key-value cache.
   */
  metapi.Cache = function () {
    var store = {};

    return {
      /**
       * Add a key-value pair to the cache. The only currently supported option is 'overwrite', which dictates
       * whether or not an existing key should be overwritten.
       *
       * @param  k        the cache key under which to store the value
       * @param  v        the value to store
       * @param  options  a dictionary of options
       * @throws ReferenceError if the key already exists and overwrite is disabled
       */
      add: function (k, v, options) {
        options = options || {};

        if (!store[k] || options.overwrite === true) {
          store[k] = v;
        } else {
          throw new ReferenceError("Cache key already exists and overwrite is disabled.");
        }
      },

      /**
       * Finds and returns the value of a cache key.
       *
       * @param k  the cache key to look up
       * @returns  the value stored under the specified cache key
       */
      get: function (k) {
        return store[k];
      },

      /**
       * Removes a value from the cache.
       *
       * @param k  the cache key to remove
       */
      delete: function (k) {
        delete store[k];
      }
    };
  };

  /**
   * Internal class representing an API response from metasmoke.
   *
   * @param success  a boolean indicating the status of the API requested
   * @param data     an object containing data returned from the request, or error description fields if the request
   *                 failed.
   */
  metapi.Response = function (success, data) {
    if (!success) {
      return {
        success: success,
        error_name: data["error_name"],
        error_code: data["error_code"],
        error_message: data["error_message"]
      };
    }

    return {
      success: success,
      data: data
    };
  };

  /**
   * Wrapper around a metasmoke API filter.
   *
   * @param required_fields  an array of fully-qualified database field (FQDF) names that are required in the response
   *                         to metasmoke API queries using this filter.
   */
  metapi.Filter = function (required_fields) {
    function createFilter() {
      var bits = new Array(Object.keys(api_field_mappings).length);
      bits.fill(0);

      for (var i = 0; i < required_fields.length; i++) {
        var index = api_field_mappings[required_fields[i]];
        bits[index] = 1;
        console.log(index, bits);
      }

      var unsafeFilter = "";
      while (bits.length) {
        var nextByte = bits.splice(0, 8).join("");
        var charCode = parseInt(nextByte.toString(), 2);
        unsafeFilter += String.fromCharCode(charCode);
        console.log(nextByte, charCode, unsafeFilter);
      }

      return encodeURIComponent(unsafeFilter);
    }

    if (api_field_mappings === {} || api_field_mappings === null) {
      return {
        success: false,
        error_name: 'missing_data',
        error_message: 'API field mappings are not available - refer to earlier error messages or call again shortly.',
        error_code: 410
      };
    }

    return {
      success: true,

      /**
       * The filter string itself. This string can be passed as the filter query string parameter to a metasmoke API
       * request.
       */
      filter: createFilter(),

      /**
       * Equivalent to the original required_fields list: an array of fields that are included in this filter.
       */
      included_fields: required_fields,

      /**
       * Equivalent to the internal api_field_mappings dictionary. This maps FQDF names to bitstring indexes, and can
       * be used by applications to create their own filters.
       */
      api_field_mappings: api_field_mappings
    };
  };

  /**
   * Wrapper around the native WebSocket class, providing functionality for multiple callbacks for a single event.
   *
   * @param address  the address of the websocket to connect to
   * @param onOpen   a callback function for the websocket's open event
   */
  metapi.WebSocket = function (address, onOpen) {
    var callbacks = [];
    var closeCallbacks = [];

    var getCallbacks = function () {
      return callbacks;
    };

    var getCloseCallbacks = function () {
      return closeCallbacks;
    };

    var addCallback = function (callback) {
      callbacks.push(callback);
    };

    var addCloseCallback = function (callback) {
      callbacks.push(callback);
    };

    var removeCallback = function (callback) {
      closeCallbacks.pop(callback);
    };

    var removeCloseCallback = function (callback) {
      closeCallbacks.pop(callback);
    };

    var conn = new ReconnectingWebSocket(address);

    if (onOpen && typeof onOpen === "function") {
      conn.onopen = onOpen;
    }

    conn.onmessage = function (data) {
      for (var i = 0; i < callbacks.length; i++) {
        callbacks[i](data);
      }
    };

    conn.onclose = function (data) {
      for (var i = 0; i < closeCallbacks.length; i++) {
        closeCallbacks[i](data);
      }
    };

    return {
      /**
       * The underlying native WebSocket connection object.
       */
      _conn: conn,

      /**
       * Retrieves an arrary of existing callbacks for the message event.
       *
       * @returns an array of functions, each of which is a message callback
       */
      getCallbacks: getCallbacks,

      /**
       * Retrieves an arrary of existing callbacks for the socket close.
       *
       * @returns an array of functions, each of which is a socket close
       */
      getCloseCallbacks: getCloseCallbacks,

      /**
       * Appends a message callback function to the callbacks list.
       *
       * @param callback  a function with optional data parameter, used as a callback to the message event
       */
      addCallback: addCallback,

      /**
       * Appends a socket close callback function to the close callbacks list.
       *
       * @param callback  a function with optional data parameter, used as a callback to the socket close event
       */
      addCloseCallback: addCloseCallback,

      /**
       * Given a reference to a callback function, removes that function from the message callbacks list.
       *
       * @param callback  a reference to a callback function already in the socket's message callbacks list
       */
      removeCallback: removeCallback,

      /**
       * Given a reference to a close callback function, removes that function from the message close callbacks list.
       *
       * @param callback  a reference to a close callback function already in the socket's message close callbacks list
       */
      removeCloseCallback: removeCloseCallback,

      /**
       * Sends a message through the websocket.
       *
       * @param data  an object containing data to be sent down the websocket connection
       */
      send: function (data) {
        conn.send(data);
      }
    };
  };

  /**
   * A metapi.Cache instance used to cache posts returned from the metasmoke API.
   */
  metapi.postCache = new metapi.Cache();

  /**
   * Retrieves a post from the metasmoke API.
   *
   * @param ident     a string URL or numeric ID representing the post to fetch
   * @param key       a string containing the requester's MS API key
   * @param options   a dictionary of options that will be sent as query string parameters to the API
   * @param callback  a callback function that accepts a metapi.Response as a single parameter
   */
  metapi.getPost = function (ident, key, options, callback) {
    options = options || {};

    var overwrite = options.hasOwnProperty("forceReload") && delete options["forceReload"];

    var optionString = "";
    var optionNames = Object.keys(options);
    for (var i = 0; i < optionNames.length; i++) {
      optionString += "&" + optionNames[i] + "=" + options[optionNames[i]];
    }

    var cached = metapi.postCache.get(ident);
    if (cached && !overwrite) {
      return new metapi.Response(true, cached);
    }

    var fetchUrl = "";
    if (typeof ident === "string") {
      fetchUrl = "https://metasmoke.erwaysoftware.com/api/posts/urls?urls=" + ident + "&key=" + key + optionString;
    }
    else if (typeof ident === "number") {
      fetchUrl = "https://metasmoke.erwaysoftware.com/api/posts/" + ident + "?key=" + key + optionString;
    }

    $.ajax({
      type: "GET",
      url: fetchUrl
    })
    .done(function (data) {
      var items = data.items;
      if (items.length > 0 && items[0]) {
        metapi.postCache.add(ident, items[0]);
        callback(new metapi.Response(true, items[0]));
      } else {
        callback(new metapi.Response(false, {
          error_name: "no_item",
          error_code: 404,
          error_message: "No items were returned or the requested item was null."
        }));
      }
    }).error(function (jqXhr) {
      callback(new metapi.Response(false, jqXhr.responseText));
    });
  };

  /**
   * Given a metasmoke MicrOAuth code, exchanges that code for an API write token.
   *
   * @param code      the 7-hex-digit code provided to the app by a user
   * @param key       the requester's MS API key
   * @param callback  a callback function accepting a metapi.Response as a single parameter
   */
  metapi.swapCodeForToken = function (code, key, callback) {
    $.ajax({
      type: "GET",
      url: "https://metasmoke.erwaysoftware.com/oauth/token?code=" + code + "&key=" + key
    }).done(function (data) {
      callback(new metapi.Response(true, data));
    }).error(function (jqXhr) {
      callback(new metapi.Response(false, jqXhr.responseText));
    });
  };

  /**
   * Sends a single feedback to the metasmoke API.
   *
   * @param id        the numeric of the post to feed back on
   * @param feedback  a string containing the type of feedback to send (i.e. "tpu-" or "fp-")
   * @param key       the requester's MS API key
   * @param token     a valid MS API write token for the user sending the feedback
   * @param callback  a callback function accepting a metapi.Response as a single parameter
   */
  metapi.sendFeedback = function (id, feedback, key, token, callback) {
    $.ajax({
      type: "POST",
      url: "https://metasmoke.erwaysoftware.com/api/w/post/" + id + "/feedback?type=" + feedback + "&key=" + key + "&token=" + token
    }).done(function (data) {
      callback(new metapi.Response(true, data.items));
    }).error(function (jqXhr) {
      callback(new metapi.Response(false, jqXhr.responseText));
    });
  };

  /**
   * Reports a post to Smokey via the metasmoke API.
   *
   * @param url       a string containing the URL to the post to be reported
   * @param key       the requester's MS API key
   * @param token     a valid MS API write token for the user reporting the post
   * @param callback  a callback function accepting a metapi.Response as a single parameter
   */
  metapi.reportPost = function (url, key, token, callback) {
    $.ajax({
      type: "POST",
      url: "https://metasmoke.erwaysoftware.com/api/w/post/report?post_link=" + url + "&key=" + key + "&token=" + token
    }).done(function () {
      callback(new metapi.Response(true, {}));
    }).error(function () {
      callback(new metapi.Response(false, {error_name: "crap", error_code: 911, error_message: "Something has gone very wrong."}));
    });
  };

  /**
   * Casts a spam flag on a post via the metasmoke API. This also creates a FlagLog record on metasmoke, to track
   * flags being cast via the API.
   *
   * @param id        the numeric MS ID of the post to cast a flag on
   * @param key       the requester's MS API key
   * @param token     a valid MS API write token for the user casting the flag
   * @param callback  a callback function accepting a metapi.Response as a single parameter
   */
  metapi.spamFlagPost = function (id, key, token, callback) {
    $.ajax({
      type: "POST",
      url: "https://metasmoke.erwaysoftware.com/api/w/post/" + id + "/spam_flag?key=" + key + "&token=" + token
    }).done(function (data) {
      callback(new metapi.Response(true, {backoff: data.backoff}));
    }).error(function (jqXhr) {
      if (jqXhr.status === 409) {
        callback(new metapi.Response(false, jqXhr.responseText));
      } else if (jqXhr.status === 500) {
        callback(new metapi.Response(false, {
          error_name: "flag_failed",
          error_code: 500,
          error_message: jqXhr.responseText.message
        }));
      }
    });
  };

  /**
   * Connects to the metasmoke API websocket and passes messages back to the caller via a callback.
   *
   * @param key              the requester's MS API key
   * @param messageCallback  a callback function accepting a single data parameter containing a message received on the
   *                         websocket
   */
  metapi.watchSocket = function (key, messageCallback, closeCallback) {
    if (!ReconnectingWebSocket) {
      pendingSockets.push({
        key: key,
        messageCallback: messageCallback,
        closeCallback: closeCallback
      });
      return;
    }

    var sock;
    if (!sockets.hasOwnProperty(key)) {
      sockets[key] = new metapi.WebSocket("wss://metasmoke.erwaysoftware.com/cable", function () {
        this.send(JSON.stringify({
          identifier: JSON.stringify({
            channel: "ApiChannel",
            key: key
          }),
          command: "subscribe"
        }));
      });
    }
    sock = sockets[key];

    sock.addCallback(messageCallback);

    if (closeCallback) {
      sock.addCloseCallback(closeCallback);
    }
  };

  /**
   * Registers sockets / listeners for socckets that were requested while an dependency was still loading.
   */
  metapi.watchPendingSockets = function () {
    while (pendingSockets.length) {
      var options = pendingSockets.shift();
      metapi.watchSocket(options.key, options.messageCallback);
    }
  };
})();
