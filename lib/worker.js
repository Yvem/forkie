'use strict';

module.exports = worker;

/**
 * Turn a regular node.js process into a graceful process
 *   this process will be able to gracefully start and stop instead
 *   of exiting brutally
 * @param  {String} title process title, will be sent back to master when ready
 * @param  {Object} fns, provide a fns.start and fn.stop Function to be called when exiting
 * @return {EventEmitter} worker
 */
function worker(title, fns) {
  var debug = require('debug')('forkie:worker');
  var EventEmitter = require('events').EventEmitter;
  var emitter = new EventEmitter();

  var working;
  var exitAsked;

  var graceful = {
    start: function() {
      fns.start(function() {
        debug('starting %d', process.pid);
        if (process.send) {
          process.send({graceful: {status: 'started', title: title}});
        }

        emitter.emit('started');
      });
    },
    stop: function() {
      debug('stopping %d', process.pid);
      teardown();
      fns.stop(function() {
        if (process.send) {
          process.send({graceful: {status: 'stopped', title: title}});
        }

        emitter.emit('stopped');
      });
    }
  };

  var exitSignalHandler = handleMasterMessage.bind(null, {graceful: {action: 'stop'}}, true);
  var exitSignals = ['SIGTERM', 'SIGINT'];

  // let people subscribe to events
  process.nextTick(init);

  function init() {
    // process was forked, we wait for the master to ask us for a start
    if (process.send) {
      process.addListener('message', handleMasterMessage);
      process.addListener('disconnect', masterDied);
      process.send({graceful: {status:'ready', title: title}});
      emitter.emit('ready');
    } else {
      graceful.start();
    }

    exitSignals.forEach(subscribe);
  }

  function teardown() {
    if (process.send) {
      process.removeListener('message', handleMasterMessage);
    }
    exitSignals.forEach(unsubscribe);
  }

  function subscribe(signal) {
    debug('subscribing to signal %s %d', signal, process.pid);
    process.addListener(signal, exitSignalHandler);
  }

  function unsubscribe(signal) {
    debug('unsubscribing from signal %s %d', signal, process.pid);
    try {
      process.removeListener(signal, exitSignalHandler);
    } catch (e) {
      // we don't care
    }
  }

  function handleMasterMessage(msg/*, quit */) {
    var quit = arguments[1];
    if (!quit) {
      debug('received %j from master, %d', msg, process.pid);
    } else {
      debug('was asked by signal to quit, %d', process.pid);
    }

    if (msg && msg.graceful && msg.graceful.action) {
      switch(msg.graceful.action) {
        case 'start':
          graceful.start();
          break;
        case 'stop':
          if (exitAsked) {
            return;
          }

          exitAsked = true;

          if (!working) {
            graceful.stop();
          }
          break;
      }
    }
  }

  emitter.working = function setWorking(status) {
    working = status;

    if (working === false && exitAsked) {
      graceful.stop();
    }
  };

  function masterDied() {
    console.error('Master process died, forced exit of ' + title);
    process.nextTick(process.exit.bind(process, 1));
  }

  return emitter;
}