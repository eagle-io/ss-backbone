var fs, zlib, pathlib;
fs = require('fs');
zlib = require('zlib');
pathlib = require('path');

module.exports = function(responderId, config, ss) {
  var backbone, backboneSync, client_api_registration, name, underscore;
  name = config && config.name || 'backbone';
  underscore   = fs.readFileSync(__dirname + '/../vendor/lib/underscore.js', 'utf8');
  backbone     = fs.readFileSync(__dirname + '/../vendor/lib/backbone.js', 'utf8');
  backboneSync = fs.readFileSync(__dirname + '/client.js', 'utf8');
  client_api_registration = fs.readFileSync(__dirname + '/register.js', 'utf8');
  ss.client.send('code', 'init', underscore);
  ss.client.send('code', 'init', backbone);
  ss.client.send('code', 'init', backboneSync);
  ss.client.send('mod', 'ss-backbone', client_api_registration);
  ss.client.send('code', 'init', "require('ss-backbone')(" + responderId + ", {}, require('socketstreamx').send(" + responderId + "));");
  return {
    name: name,
    interfaces: function(middleware) {
      return {
        websocket: function(msg, meta, send) {
          var handleError, model, req, request;
          request = require('./request')(ss, middleware, config);
          msg = JSON.parse(msg);

          var scope = ss.tracer.scope()
          var span  = ss.tracer.startSpan('BB_SYNC')

          scope.activate(span, function() {

            // decompress message if contentEncoding is GZIP or ZLIB
            return decompressMessageData(msg, function(err, msg) {

              if (err) {
                return ss.log('↩'.red + (" backbone:" + msg.modelname.toLowerCase() + "." + method).red + ' ' + err);
              }            

              model = msg.model;

              if ((msg.method === "read") && (isArray(model))) {
                method = "readAll";
              } else {
                method = msg.method;
              }

              req = {
                modelName: msg.modelname,
                cid: msg.cid,
                model: msg.model,
                modelOptions: msg.options,
                method: method,
                socketId: meta.socketId,
                clientIp: meta.clientIp,
                sessionId: meta.sessionId,
                csrfToken: meta.csrfToken,
                transport: meta.transport,
                receivedAt: Date.now()
              };

              // log backbone request & resposne
              var msgMethodPath = req.modelName.toLowerCase() + "." + req.method;
              var msgLogName    = "backbone:" + msgMethodPath;
              var msgLogModel   = (isNonEmptyObject(msg.model)) ? JSON.stringify(msg.model) : "";
              var msgLogOptions = (isNonEmptyObject(msg.options)) ? JSON.stringify(msg.options) : "";
              var id            = (msg.model && msg.model._id) ? msg.model._id : (msg.cid || null);

              span.addTags({
                ip_address: req.clientIp,
                socket_id: req.socketId,
                method: msgMethodPath
              })

              ss.log('↪'.cyan + ' ' + msgLogName.grey + ' ' + msgLogModel + ' ' + msgLogOptions);

              handleError = function(e) {
                var err, obj;
                // never return errors with stack traces to client
                error = e && e.stack ? 'Request failed' : e
                // ensure error is always an object or wrap it
                error = typeof e === "object" ? e : {msg: e}

                obj = {
                  i: id,
                  m: msg.modelname,
                  r: method,
                  e: "ERROR",
                  p: error
                };

                ss.log('↩'.red + ' ' + msgLogName.red + ' ' + JSON.stringify(e));
                if (e.stack) {
                  ss.log(e.stack.split("\n").splice(1).join("\n"));
                }
                span.setTag('error', e);
                span.finish();
                return send(JSON.stringify(obj));
              };
              try {
                return request(model, req, function(err, response) {
                  if (req.session && req.session.userId) span.setTag('user_id', req.session.userId);
                  if (err) {
                    return handleError(err);
                  }
                  if (isArray(response) && !response.length) {
                    span.finish();
                    return false;
                  }
                  var timeTaken;
                  var obj;
                  timeTaken = Date.now() - req.receivedAt;
                  ss.log('↩'.green + ' ' + msgLogName.grey + ' ' + ("(" + timeTaken + "ms)").grey);
                  obj = {
                    i: id,
                    m: msg.modelname,
                    r: method,
                    e: "REPLY",
                    p: response
                  }
                  span.finish();
                  return send(JSON.stringify(obj));
                });
              } catch (e) {
                return handleError(e);
              }
            }) 
          }); // end scope.activate
        }
      };
    }
  };
};

isArray = function(obj) {
  return Object.prototype.toString.call(obj) === "[object Array]";
};

isNonEmptyObject = function(obj) {
  return (((Object.prototype.toString.call(obj) === "[object Array]") || (Object.prototype.toString.call(obj) === "[object Object]")) && (Object.keys(obj).length > 0));
};

decompressMessageData = function(msg, cb) {
  var dataAttr, decodedData
  var encodingMethod = msg.contentEncoding || null;
  if (!(encodingMethod === "GZIP" || encodingMethod === "ZLIB")) {
    return cb(null, msg);
  }
  
  // check if content is the 'model' or 'models' attribute (never both).
  dataAttr = msg.model != null ? "model" : "models";
  if (!dataAttr) return cb(null, msg);
  zlib.unzip(Buffer.from(msg[dataAttr], "base64"), function(err, buffer){
    // re-assign the decompressed content to the 'model' or 'models' attribute 
    try {
      msg[dataAttr] = JSON.parse(buffer.toString("utf8"));
      return cb(null, msg)
    }
    catch (e) {
      return cb(e + "\nbase64: " + msg[dataAttr] + "\nbuffer: " + buffer.toString("utf8"), msg)
    }
  });
};

