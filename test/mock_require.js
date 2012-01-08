/*!

  Copyright (c) 2011 Chad Weider

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.

*/

var fs = require('fs');
var pathutil = require('path');
var urlutil = require('url');
var events = require('events');

var kernelPath = pathutil.join(__dirname, '..', 'kernel.js');
var kernel = fs.readFileSync(kernelPath, 'utf8');

var buildKernel = require('vm').runInThisContext(
  '(function (XMLHttpRequest) {return ' + kernel + '})', kernelPath);

/* Cheap URL request implementation */
var fs_client = (new function () {
  var STATUS_MESSAGES = {
    403: '403: Access denied.'
  , 404: '404: File not found.'
  , 405: '405: Only the HEAD or GET methods are allowed.'
  , 500: '500: Error reading file.'
  };

  function request(options, callback) {
    var path = options.path;
    var method = options.method;

    var response = new (require('events').EventEmitter);
    response.setEncoding = function (encoding) {this._encoding = encoding};
    response.statusCode = 504;
    response.headers = {};

    var request = new (require('events').EventEmitter);
    request.end = function () {
      if (options.method != 'HEAD' && options.method != 'GET') {
        response.statusCode = 405;
        response.headers['Allow'] = 'HEAD, GET';

        callback(response);
        response.emit('data', STATUS_MESSAGES[response.statusCode])
        response.emit('end');
      } else {
        fs.stat(path, function (error, stats) {
          if (error) {
            if (error.code == 'ENOENT') {
              response.StatusCode = 404;
            } else if (error.code == 'EACCESS') {
              response.StatusCode = 403;
            } else {
              response.StatusCode = 502;
            }
          } else if (stats.isFile()) {
            var date = new Date()
            var modifiedLast = new Date(stats.mtime);
            var modifiedSince = (options.headers || {})['if-modified-since'];

            response.headers['Date'] = date.toUTCString();
            response.headers['Last-Modified'] = modifiedLast.toUTCString();

            if (modifiedSince && modifiedLast
                && modifiedSince >= modifiedLast) {
              response.StatusCode = 304;
            } else {
              response.statusCode = 200;
            }
          } else {
            response.StatusCode = 404;
          }

          if (method == 'HEAD') {
            callback(response);
            response.emit('end');
          } else if (response.statusCode != 200) {
            response.headers['Content-Type'] = 'text/plain; charset=utf-8';

            callback(response);
            response.emit('data', STATUS_MESSAGES[response.statusCode])
            response.emit('end');
          } else {
            fs.readFile(path, function (error, text) {
              if (error) {
                if (error.code == 'ENOENT') {
                  response.statusCode = 404;
                } else if (error.code == 'EACCESS') {
                  response.statusCode = 403;
                } else {
                  response.statusCode = 502;
                }
                response.headers['Content-Type'] = 'text/plain; charset=utf-8';

                callback(response);
                response.emit('data', STATUS_MESSAGES[response.statusCode])
                response.emit('end');
              } else {
                response.statusCode = 200;
                response.headers['Content-Type'] =
                    'application/javascript; charset=utf-8';

                callback(response);
                response.emit('data', text);
                response.emit('end');
              }
            });
          }
        });
      }
    };
    return request;
  }
  this.request = request;
}());

function requestURL(url, method, headers, callback) {
  var parsedURL = urlutil.parse(url);
  var client = undefined;
  if (parsedURL.protocol == 'file:') {
    client = fs_client;
  } else if (parsedURL.protocol == 'http:') {
    client = require('http');
  } else if (parsedURL.protocol == 'https:') {
    client = require('https');
  }
  if (client) {
    var request = client.request({
      host: parsedURL.host
    , port: parsedURL.port
    , path: parsedURL.path
    , method: method
    , headers: headers
    }, function (response) {
      var buffer = undefined;
      response.setEncoding('utf8');
      response.on('data', function (chunk) {
        buffer = buffer || '';
        buffer += chunk;
      });
      response.on('close', function () {
        callback(502, {});
      });
      response.on('end', function () {
        callback(response.statusCode, response.headers, buffer);
      });
    });
    request.on('error', function () {
      callback(502, {});
    });
    request.end();
  }
}

function normalizePathAsURI(path) {
  var parsedUrl = urlutil.parse(path);
  if (parsedUrl.protocol === undefined) {
    parsedUrl.protocol = 'file:';
    parsedUrl.path = pathutil.resolve(parsedUrl.path);
  }
  return urlutil.format(parsedUrl);
}

var buildMockXMLHttpRequestClass = function () {
  var emitter = new events.EventEmitter();
  var requestCount = 0;
  var idleTimer = undefined;
  var idleHandler = function () {
    emitter.emit('idle');
  };
  var requested = function (info) {
    clearTimeout(idleTimer);
    requestCount++;
    emitter.emit('requested', info);
  };
  var responded = function (info) {
    emitter.emit('responded', info);
    requestCount--;
    if (requestCount == 0) {
      idleTimer = setTimeout(idleHandler, 0);
    }
  };

  var MockXMLHttpRequest = function () {
  };
  MockXMLHttpRequest.prototype = new function () {
    this.open = function(method, url, async) {
      this.async = async;
      this.url = normalizePathAsURI(url);
    }
    this.withCredentials = false; // Pass CORS capability checks.
    this.send = function () {
      var parsedURL = urlutil.parse(this.url);

      var info = {
        async: !!this.async
      , url: this.url
      };

      if (!this.async) {
        if (parsedURL.protocol == 'file:') {
          requested(info);
          try {
            this.status = 200;
            this.responseText = fs.readFileSync(parsedURL.path);
          } catch (e) {
            this.status = 404;
          }
          this.readyState = 4;
          responded(info);
        } else {
          throw "The resource at " + JSON.stringify(this.url)
            + " cannot be retrieved synchronously.";
        }
      } else {
        var self = this;
        requestURL(this.url, 'GET', {},
          function (status, headers, content) {
            self.status = status;
            self.responseText = content;
            self.readyState = 4;
            var handler = self.onreadystatechange;
            handler && handler();
            responded(info);
          }
        );
        requested(info);
      }
    }
  };
  MockXMLHttpRequest.emitter = emitter;

  return MockXMLHttpRequest;
}

function requireForPaths(rootPath, libraryPath) {
  var MockXMLHttpRequest = buildMockXMLHttpRequestClass();
  var mockRequire = buildKernel(MockXMLHttpRequest);

  if (rootPath !== undefined) {
    mockRequire.setRootURI(normalizePathAsURI(rootPath));
  }
  if (libraryPath != undefined) {
    mockRequire.setLibraryURI(normalizePathAsURI(libraryPath));
  }

  mockRequire.emitter = MockXMLHttpRequest.emitter;

  mockRequire._compileFunction = function (code, filename) {
    return require('vm').runInThisContext('(function () {'
      + code + '\n'
      + '})', filename);
  };

  return mockRequire;
}

exports.requireForPaths = requireForPaths;
