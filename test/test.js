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
var util = require('util');
var pathutil = require('path');
var requireForPaths = require('../mock_require').requireForPaths;

var modulesPath = pathutil.join(__dirname, 'modules');

function assertEqual(expected, actual, reason) {
  if (expected == actual) {
    console.log('.');
  } else {
    console.log('F');
    console.log(expected + ' != '  + actual);
    reason && console.log(reason);
    throw new Error()
  }
}
function assertThrow(f, match) {
  var error = undefined;
  try {
    f();
  } catch (e) {
    error = e;
  } finally {
    assertEqual(true, !!error);
    if (match) {
      assertEqual(true, !!error.toString().match(match),
      match.toString() + " should match " + JSON.stringify(error.toString()));
    }
  }
}

/* Test library resolution. */
r = requireForPaths(modulesPath + '/root', modulesPath + '/library');
assertEqual('1.js', r('1.js').value);
assertEqual('/1.js', r('/1.js').value);
/* Test suffix resolution. */
assertEqual('/1.js', r('/1').value);
assertEqual(r('/1.js'), r('/1'));

/* Test questionable 'extra' relative paths. */
r = requireForPaths(modulesPath + '/root', modulesPath + '/library');
assertEqual('/../root/1.js', r('/../root/1').value);
assertEqual('/../library/1.js', r('../library/1').value);

/* Test index resolution. */
r = requireForPaths(modulesPath + '/index');
assertEqual('/index.js', r('/').value);
assertEqual('/index.js', r('/index').value);
assertEqual('/index/index.js', r('/index/').value);
assertEqual('/index/index.js', r('/index/index').value);
assertEqual('/index/index.js', r('/index/index.js').value);
assertEqual('/index/index/index.js', r('/index/index/').value);
assertEqual('/index/index/index.js', r('/index/index/index.js').value);

/* Test path normalization. */
assertEqual('/index.js', r('./index').value);
assertEqual('/index.js', r('/./index').value);
assertEqual('/index/index.js', r('/index/index/../').value);
assertEqual('/index/index.js', r('/index/index/../../index/').value);

/* Test exceptions. */
assertThrow(function () {r(null)}, "toString");
assertThrow(function () {r('1', '1')}, "ArgumentError");
assertThrow(function () {r('1', '1', '1')}, "ArgumentError");

/* Test module definitions. */
r = requireForPaths('/dev/null', '/dev/null');
r.define("user/module.js", function (require, exports, module) {
  exports.value = module.id;
});
r.define("user/module.js", function (require, exports, module) {
  exports.value = "REDEFINED";
});
r.define({
  "user/module1.js": function (require, exports, module) {
    exports.value = module.id;
  }
, "user/module2.js": function (require, exports, module) {
    exports.value = module.id;
  }
, "user/module3.js": function (require, exports, module) {
    exports.value = module.id;
  }
});
assertThrow(function () {r.define()}, "ArgumentError");
assertThrow(function () {r.define(null, null)}, "ArgumentError");

assertEqual('user/module.js', r('user/module').value);
assertEqual('user/module1.js', r('user/module1').value);
assertEqual('user/module2.js', r('user/module2').value);
assertEqual('user/module3.js', r('user/module3').value);

/* Test cycle detection */
r = requireForPaths('/dev/null', '/dev/null');
r.define({
  "one_cycle.js": function (require, exports, module) {
    exports.value = module.id;
    exports.one = require('one_cycle');
  }

, "two_cycle.js": function (require, exports, module) {
    exports.two = require('two_cycle.1');
  }
, "two_cycle.1.js": function (require, exports, module) {
    exports.value = module.id;
    exports.two = require('two_cycle.2');
  }
, "two_cycle.2.js": function (require, exports, module) {
    exports.value = module.id;
    exports.one = require('two_cycle.1');
  }

, "n_cycle.js": function (require, exports, module) {
    exports.two = require('n_cycle.1');
  }
, "n_cycle.1.js": function (require, exports, module) {
    exports.value = module.id;
    exports.two = require('n_cycle.2');
  }
, "n_cycle.2.js": function (require, exports, module) {
    exports.value = module.id;
    exports.three = require('n_cycle.3');
  }
, "n_cycle.3.js": function (require, exports, module) {
    exports.value = module.id;
    exports.one = require('n_cycle.1');
  }
});

assertThrow(function () {r('one_cycle')}, 'CircularDependency');
assertThrow(function () {r('two_cycle')}, 'CircularDependency');
assertThrow(function () {r('n_cycle')}, 'CircularDependency');

r = requireForPaths();
r.define({
  "non_cycle.js": function (require, exports, module) {
    exports.value = module.id;
    require("non_cycle.1.js");
  }
, "non_cycle.1.js": function (require, exports, module) {
    exports.value = module.id;
    require("non_cycle.2.js", function (two) {exports.one = two});
  }
, "non_cycle.2.js": function (require, exports, module) {
    exports.value = module.id;
    require("non_cycle.1.js", function (one) {exports.one = one});
  }
});
var non1 = r("non_cycle.1.js");

console.log("All done")
