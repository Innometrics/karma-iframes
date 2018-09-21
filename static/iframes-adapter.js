// jshint es3: false
// jshint esversion: 6

(function(karma) {
	'use strict';

	var isDebug = document.location.href.indexOf('debug.html') > -1;

	function Suite(path, showTitle) {
        // state is one of
        // • 'pending' (before the total is known)
        // • 'started' (after total is known but before all suites have executed)
        // • 'complete' (when total === finished)
        this.state = 'pending';
        this.fileName = path.match(/\/([^/]+)\.iframe\.html$/)[1];
        this.path = path;
        this.iframe = document.createElement('iframe');
        this.wrapper = document.createElement('span');
        this.showTitle = showTitle;
        this.total = NaN;
        this.finished = 0;
	}

	Suite.prototype.init = function(suites) {
		if(isDebug) {
			console.debug('Loaded suite ' + this.fileName);
		}
		// Add the suite as pending
        var me = this;
		suites[this.path] = this;

		var iframe = this.iframe;

		// Remap console
        this.domContentLoadedListener = function () {
            iframe.contentWindow.console = console;
        };
        iframe.addEventListener('DOMContentLoaded', this.domContentLoadedListener, false);

		// Listen to messages from the iFrame
		this.messageListener = function (msg) {
			if(!msg.source || iframe.contentWindow !== msg.source) {
				return; // ignore messages from other iframes
			}

            var data = msg.data;

            if (typeof data === 'string') {
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    console.warn(e);
                }
            }

			// Provide some namespace for the message
			if(!Array.isArray(data) || data[0] !== 'iframe-test-results') {
				return;
			}

			var message = data[1];
			var arg = data[2];

			if(message === 'started') {
                me.started(arg);
			} else if(message === 'result') {
                me.result(arg);
			} else if(message === 'complete') {
                me.complete(arg);
			} else {
				// Other message (log, error); send directly to karma
				karma[message].apply(karma, data.slice(2));
			}
		};
		window.addEventListener('message', this.messageListener, false);
	};

	Suite.prototype.run = function() {
        if(isDebug) {
            console.debug('Running suite ' + this.fileName);
        }
        if (this.showTitle) {
            this.wrapper.style.float = 'left';
            this.wrapper.innerHTML = this.fileName + '<br>';
        }
        this.wrapper.appendChild(this.iframe);
        this.iframe.src = this.path;
        document.body.appendChild(this.wrapper)
	};

	Suite.prototype.started = function(total) {
		if(isDebug) {
            console.debug('Suite ' + this.fileName + ' has started, expects ' + total + ' tests');
		}
		this.state = 'started';
		this.total = total;
		suiteStarted();
	};

	Suite.prototype.result = function(result) {
		if(isDebug) {
            console.debug('Suite ' + this.fileName + ' has a result, ' + result);
		}
		result.suite = result.suite || [];
		result.suite.unshift(this.fileName.replace(/\.iframe\.html$/, ''));
		result.id = this.fileName+'#'+(result.id || '');
		this.finished++;
		sendResult(result);
	};

	Suite.prototype.complete = function(result) {
		if(isDebug) {
            console.debug('Suite ' + this.fileName + ' has completed with ' + this.finished + ' of ' + this.total + ' tests');
		}
		this.state = 'complete';
		suiteComplete(result);
        this.onComplete();
		this.cleanup();
	};

    Suite.prototype.onComplete = function() {};

	Suite.prototype.cleanup = function() {
        this.iframe.removeEventListener('DOMContentLoaded', this.domContentLoadedListener, false);
        this.iframe.parentNode.removeChild(this.iframe);
        this.wrapper.parentNode.removeChild(this.wrapper);
        window.removeEventListener('message', this.messageListener, false);
        this.iframe = null;
        this.wrapper = null;
        this.messageListener = null;
        this.domContentLoadedListener = null;
	};

	// Map suite files to suite instances
	var suites = {};

	function suitesWithState(state) {
		var isNeg = state[0] === '!';
		if(isNeg) {
			state = state.substr(1);
		}
        var result = {};
		Object.keys(suites)
			.filter(function (path) {
				return isNeg ? suites[path].state !== state : suites[path].state === state;
			})
			.forEach(function (path) {
				result[path] = suites[path];
			});
		return result;
	}

	function countTests() {
		return Object.keys(suites)
			.map(function (path) {return suites[path]; })
			.reduce(function (sum, suite) {
                var total = sum[0] + suite.total;
                var finished = sum[1] + suite.finished;
				return [total, finished];
			}, [0, 0]);
	}

	function hasPendingSuites() {
        var startedSuites = suitesWithState('!pending');
		return Object.keys(startedSuites).length < Object.keys(suites).length;
	}

	var pendingResults = [];
	function sendResult(result) {
		if(hasPendingSuites()) {
			// We should not send results to karma before all suites have started, queue them
			pendingResults.push(result);
			return;
		}
		// Send result directly
		karma.result(result);
	}

	// Some suite has started
	function suiteStarted() {
		// Have all suites started?
		if(hasPendingSuites()) {
			return;
		}
		// All suites have started, send the total to karma
        var cntT = countTests();
        var total = cntT[0],
            finished =cntT[1];

		if(isDebug) {
            console.debug('All ' + Object.keys(suites).length + ' suites have started, expecting ' + total + ' tests (of which ' + finished + ' have already finished)');
		}
		karma.info({total: total});
		// Send the pending results
		pendingResults.forEach(sendResult);
		pendingResults = [];
	}

	// Some suite has completed
	function suiteComplete(result) {
        if (result.coverage) {
            coverageCollector.addCoverage(result.coverage);
        }

		// Have all suites completed?
        var completedSuites = suitesWithState('complete');
		if(Object.keys(completedSuites).length < Object.keys(suites).length) {
            result.coverage = null;
			return;
		}
		// All suites have completed, send the “complete” message to karma
		if(isDebug) {
            var cntT = countTests();
            var total = cntT[0],
                finished =cntT[1];
            console.debug('All ' + Object.keys(suites).length + ' suites have completed, ran ' + finished + ' of ' + total + ' tests');
		}
        if (result.coverage) {
            result.coverage = coverageCollector.getCoverage();
        }
		karma.complete(result);
	}

    function start () {
        // jshint validthis: true
        var files = Object.keys(karma.files).filter(function (file) {return file.match(/\.iframe\.html$/);});
        var concurrency = parseInt(karma.config.concurrency, 10) || 10;
        var showFrameTitle = karma.config.showFrameTitle || false;
        var ran = 0;
        var preparedSuites = [];
        preparedSuites = files.map(function (file) {
            var suite = new Suite(file, showFrameTitle);
            suite.init(suites);
            return suite;
        });

        preparedSuites.reverse();

        function runNextSuite () {
            var suite = preparedSuites.pop();
            if (!suite) {
                return;
            }
            suite.onComplete = function () {
                ran--;
                runNextSuite();
            };
            suite.run();
            ran++;
            if (ran < concurrency) {
                setTimeout(runNextSuite, 0);
            }
        }

        runNextSuite();
    }

    //
    // Helper to collect coverages from each suite
    // (supports only one coverage format)
    //
    var coverageCollector = {
        coverage: {},

        addCoverage: function (coverage) {
            this.coverage = this.mergeCoverages([coverage]);
        },

        getCoverage: function () {
            var coverage = this.coverage;
            this.cleanup();
            return coverage;
        },

        cleanup: function () {
            this.coverages = {};
        },

        mergeCoverages: function (coverages) {
            var mergedCoverage = this.coverage,
                collector = this;

            coverages.forEach(function (coverageBySrc) {
                Object.keys(coverageBySrc).forEach(function (srcKey) {
                    if (!(srcKey in mergedCoverage)) {
                        mergedCoverage[srcKey] = collector.dirtyClone(coverageBySrc[srcKey]);
                        return;
                    }

                    var masterCoverage = mergedCoverage[srcKey],
                        coverage = coverageBySrc[srcKey];

                    // b - branches,
                    ['b'].forEach(function (prop) {
                        if (!coverage[prop]) {
                            return;
                        }
                        Object.keys(coverage[prop]).forEach(function (branch) {
                            if (!coverage[prop][branch]) {
                                return;
                            }
                            (masterCoverage[prop][branch] || []).forEach(function (value, index) {
                                masterCoverage[prop][branch][index] += (coverage[prop][branch] || [])[index] || 0;
                            });
                        });
                    });

                    // f - functions, s - statements
                    ['f', 's'].forEach(function (prop) {
                        Object.keys(masterCoverage[prop]).forEach(function (index) {
                            masterCoverage[prop][index] += (coverage[prop] || [])[index] || 0;
                        });
                    });
                });
            });

            return mergedCoverage;
        },

        dirtyClone: function (object) {
            return JSON.parse(JSON.stringify(object));
        }
    };

	karma.start = start;
})(window.__karma__);

