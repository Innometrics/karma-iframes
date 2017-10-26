// Mock the __karma__ to be used inside the iframe
// Send progress to the parent frame for iframes-adapter to send to the real __karma__ of the real context

window.__karma__ = (function() {
	function UNIMPLEMENTED_START() {
		throw new Error('An adapter should provide the start function');
	}

	var karma = {
		start: UNIMPLEMENTED_START,
		setupContext
	};
	
	function callParentKarmaMethod(methodName, args) {
		args.unshift('iframe-test-results', methodName);
		window.parent.postMessage(args, window.location.origin);
	}

	function postToMainContext(message, arg) {
		callParentKarmaMethod(message, [arg]);
	}
	
	DIRECT_METHODS = ['error', 'log', 'complete', 'result'];
	DIRECT_METHODS.forEach(method => {
		karma[method] = function() {
			callParentKarmaMethod(method, Array.prototype.slice.call(arguments));
		}
		karma[method].displayName = method+' (proxied)';
	});

	karma.info = function(info) {
		if('total' in info) {
			return postToMainContext('started', info.total);
		}
		callParentKarmaMethod('info', Array.prototype.slice.call(arguments));
	}
	
	karma.loaded = function(loaded) {
		// all files loaded, let's start the execution
		this.start(this.config)
		// remove reference to child iframe
		this.start = UNIMPLEMENTED_START
	};

	function setupContext(contextWindow) {
		// Perform window level bindings
		// DEV: We return `karma.error` since we want to `return false` to ignore errors
		contextWindow.onerror = function () {
			return karma.error.apply(karma, arguments)
		}

		contextWindow.dump = function () {
			karma.log('dump', arguments)
		}

		var _confirm = contextWindow.confirm
		var _prompt = contextWindow.prompt

		contextWindow.alert = function (msg) {
			karma.log('alert', [msg])
		}

		contextWindow.confirm = function (msg) {
			karma.log('confirm', [msg])
			return _confirm(msg)
		}

		contextWindow.prompt = function (msg, defaultVal) {
			karma.log('prompt', [msg, defaultVal])
			return _prompt(msg, defaultVal)
		}
	}

	return karma;
})();