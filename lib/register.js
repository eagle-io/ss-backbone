var EventEmitter2 = require('eventemitter2').EventEmitter2;
var ss = require('socketstreamx');

module.exports = function(responderId, config, send) {

  // expose the Event Emitter on 'ss.event' so it can be used in applications 
  var ee = new EventEmitter2;
  ss.registerApi('bbevent', ee);

  // expose backbone api to handle client msg sending
  ss.registerApi("backbone", function(req) {
    var msg;
    msg = JSON.stringify(req);
    send(msg);
    return void 0;
  });
  return ss.message.on(responderId, function(msg, meta) {
    var args, obj, evnt;
    obj = JSON.parse(msg);              // events are sent as JSON messages
    // obj = {
    //   i: "5cd4e9aa37e393441fe8ec57"  // _id or cid if specified
    //   m: "Node",                     // model name
    //   r: "update",                   // method
    //   e: "REPLY" | "ERROR",          // message type
    //   p: args                        // args (error or reply)
    // }
    // first arg must be event name, second arg is id
    args = [String(obj.m).toUpperCase(), obj.i];
    // third arg should always be allocated to error or set as undefined
    if (obj.e !== "ERROR") args.push(undefined)
    // add remaining params
    args = args.concat(obj.p);
    // emit event
    return ee.emit.apply(ee, args);
  });
};
