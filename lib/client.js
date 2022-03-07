var registerCollection, registerModel, decompressMessageData;
var minBytesToCompress = 1024

decompressMessageData = function(msg, cb) {
  var dataAttr, dataBytes, decompressor, dataBytesDecompressed
  var encodingMethod = msg.contentEncoding || null;
  if (!(encodingMethod === "GZIP" || encodingMethod === "ZLIB")) {
    return cb(msg);
  }
  try {
    // check if content is the 'model' or 'models' attribute (never both).
    dataAttr = msg.model != null ? "model" : "models";
    dataBytes = Zlib.Util.base64ToByteArray(msg[dataAttr]);
    if (encodingMethod === "GZIP") {
      decompressor = new Zlib.Gunzip(dataBytes);
    }
    else if (encodingMethod === "ZLIB") {
      decompressor = new Zlib.Inflate(dataBytes);
    }
    else {
      console.log("contentEncoding [" + encodingMethod + "] is not supported");
    }
    dataBytesDecompressed = decompressor.decompress();
    // re-assign the decompressed content to the 'model' or 'models' attribute (and convert UTF8 to unicode)
    dataUnicode   = unicode.fromUTF8(dataBytesDecompressed, unicode.REPLACEMENT_FALLBACK);
    msg[dataAttr] = JSON.parse(dataUnicode);
  }
  catch (err) {
    console.log("error decompressing data: " + err);
  }
  // console.log("compressed size:", dataBytes.length, "decompressed size:", dataBytesDecompressed.length)
  return cb(msg)
};

compressMessageData = function(msg, cb) {
  var dataAttr, dataBytes, compressor, dataBytesCompressed

  try {
    // check if content is the 'model' or 'models' attribute (never both).
    dataAttr = msg.model != null ? "model" : "models";
    dataBytes = Zlib.Util.toUTF8Array(JSON.stringify(msg[dataAttr]));
    if (dataBytes.length < minBytesToCompress) return cb(msg);
    compressor = new Zlib.Gzip(dataBytes);
    dataBytesCompressed = compressor.compress();
    // re-assign the decompressed content to the 'model' or 'models' attribute
    msg[dataAttr] = Zlib.Util.byteArrayToBase64(dataBytesCompressed);
    msg.contentEncoding = "GZIP"
  }
  catch (err) {
    console.log("error compressing data: " + err);
  }
  //console.log("decompressed size:", dataBytes.length, "compressed size:", dataBytesCompressed.length);
  return cb(msg);

};

registerModel = function(model, modelname, id) {
  //console.log("registering model with:", model, modelname, id);
  var modelID, modelRef;
  if (id == null) {
    id = void 0;
  }
  modelID = id || model.cid;
  modelRef = model;
  
  // save the server model data at initial create
  model.serverAttributesChanged(model.attributes);
  if (!(ss.event.listeners("sync:" + modelname + ":" + modelID).length > 0)) {
    return ss.event.on("sync:" + modelname + ":" + modelID, function(msg) {
      decompressMessageData(JSON.parse(msg), function(decompressedMsg) {
        return modelRef.trigger("backbone-sync-model", decompressedMsg);
      });
    });
  }
};

registerCollection = function(collection, modelname) {
  var collectionRef;
  collectionRef = collection;
  return ss.event.on("sync:" + modelname, function(msg) {
    decompressMessageData(JSON.parse(msg), function(decompressedMsg) {
      return collectionRef.trigger("backbone-sync-collection", decompressedMsg);
    });
  });
};

Backbone.SS = {};

Backbone.SS.JsonDiff = function(obj1, obj2) {
  var ret = {}, rett;
  for(var i in obj2) {
    rett = {};
    if (_.isArray(obj2[i])) {
      if ( (typeof obj1 !== "undefined" && obj1 !== null ? JSON.stringify(obj1[i]): null ) !== JSON.stringify(obj2[i])) {
        ret[i] = obj2[i];
      }
    }
    else if (_.isObject(obj2[i])) {
      rett = Backbone.SS.JsonDiff((typeof obj1 !== "undefined" && obj1 !== null ? obj1[i] : null), obj2[i]);
      if (!_.isEmpty(rett)) {
       ret[i]= rett;
      }
    }
    else {
      if (!obj1 || !obj1.hasOwnProperty(i) || obj2[i] !== (typeof obj1 !== "undefined" && obj1 !== null ? obj1[i] : null)) {
        ret[i] = obj2[i];
      }
    }
  }
  return ret;
};


Backbone.SS.Model = Backbone.Model.extend({
  sync: function(method, model, options) {
    var modelname, req;
    var blackAttr, _i, _len;

    // check if persist flag set to false and skip server message
    if ((typeof options !== "undefined" && options !== null ? options.persist : void 0) === false) { 
      return;
    }

    modelname = this.constructor.modelname;
    // build request object and include options
    // eg. .save({name: "new"}, {wait: true, persist: true, options: {request: "RENAME"} })  where request is an enum recognised on the server to identify the context of the model sync
    req = {
      modelname: modelname,
      method: method,
      options: ((typeof options !== "undefined" && options !== null ? options.options : void 0) || null)
    };

    // Sync/Save to Server requests:
    if (method === "update") {
      // get the difference between the _serverAttributes (state of attributes at last server sync) and the current model attributes
      modelDiff = Backbone.SS.JsonDiff(model._serverAttributes, model.attributes);
      // merge in the required whitelist attributes
      modelUpdates = _.extend({}, modelDiff, model.getWhiteListAttributes());
      // remove any blacklist attributes directly from the object
      blackList = model.getBlackListAttributes();
      // loop through the blackList and remove any of those attributes from this model
      for (_i = 0, _len = blackList.length; _i < _len; _i++) {
        blackAttr = blackList[_i];
        if (_.has(modelUpdates, blackAttr)){
          delete modelUpdates[blackAttr];
        }
      }
      req.model = modelUpdates;
    }
    else if (method === "delete") {
      // delete operation. only send whitelist attributes
      req.model = model.getWhiteListAttributes();
    }
    else {
      // read/create operation so 'sync all' model attributes (except for blacklist attributes)
      modelUpdates = $.extend(true, {}, model.attributes);
      // remove any blacklist attributes directly from the object
      blackList = model.getBlackListAttributes();
      // loop through the blackList and remove any of those attributes from this model
      for (_i = 0, _len = blackList.length; _i < _len; _i++) {
        blackAttr = blackList[_i];
        if (_.has(modelUpdates, blackAttr)){
          delete modelUpdates[blackAttr];
        }
      }
      req.model = modelUpdates;
    }

    if (model.isNew()) {
      req.cid = model.cid;
    }

    if (window.log) window.log.debug("BB Sync " + JSON.stringify(req));

    compressMessageData(req, function(compressed) {
      return ss.backbone(compressed);
    })
  },

  serverAttributesChanged: function(attr) {
    // deep clone the changed attributes

    // ISSUE: merging of arrays with primitive types does not overwrite server attributes
    // eg. this._serverAttributes.myArray = ["Item A"]
    //     attr.myArray = [] (sync'd back from server after "Item A" removed)
    //     -> jquery deep extend merges array (instead of replace it as per server-side node-extend module)
    //        this._serverAttributes.myArray = ["Item A"] instead of empty array []

    $.extend(true, this._serverAttributes, attr);
    
    // TEMPORARY FIX for node.overrides attribute
    if (_.isArray(attr.overrides)) {
      this._serverAttributes.overrides = attr.overrides;
    }

    // NOTE: an alternate workaround is to ensure null is returned from server for an empty array
    //  with schema attribute type: Mixed, default: null.
    //  eg. owner.quality.excludedQualityTypes
  },

  empty: function () {
    var modelname;
    modelname = this.constructor.modelname;
    model = this;
    //console.log("removing events from model:", "sync:" + modelname + ":" + model.id);
    ss.event.removeAllListeners("sync:" + modelname + ":" + model.cid);
    ss.event.removeAllListeners("sync:" + modelname + ":" + model.id);
    // call the close method on the model if it exists
    model.close && model.close();
    return;
  },

  initialize: function(attrs) {
    var deleted, model, modelname;
    modelname = this.constructor.modelname;
    if (!modelname) {
      throw "Cannot sync. You must set the name of the modelname on the Model class";
      delete this;
    }
    model = this;
    model.idAttribute = this.idAttribute || 'id';

    this._serverAttributes = {};
    registerModel(model, modelname, attrs[model.idAttribute] || model.cid);
    deleted = false;
    return this.on("backbone-sync-model", function(res) {
      if (res.e) {
        return;
      } else {
        if (res.method === "confirm") {
          registerModel(model, modelname, res.model[model.idAttribute]);
          this.set(res.model);
          this.serverAttributesChanged(res.model);
          this.trigger("model:registered");
        }
        if (res.method === "update") {
          this.set(res.model);
          this.serverAttributesChanged(res.model);
        }
        if (res.method === "delete") {
          if (!deleted) {
            this.trigger("destroy", model, model.collection);
          }
          if (this.collection) {
            this.collection.remove(this.id);
            // remove event listeners for model
            ss.event.removeAllListeners("sync:" + modelname + ":" + this.cid);
            ss.event.removeAllListeners("sync:" + modelname + ":" + this.id);
          }
          return deleted = true;
        }
      }
    });
  }
});

Backbone.SS.Collection = Backbone.Collection.extend({
  sync: function(method, model, options) {
    var modelname, req;
    modelname = this.constructor.modelname;
    // overwrite method if defined in options
    method = (typeof options !== "undefined" && options !== null ? options.method : void 0) ? options.method : method;
    req = {
      modelname: modelname,
      method: method,
      model: (["readAll", "readWorkspaces", "readWorkspaceChildren"].indexOf(method) >= 0 ? {} : model.toJSON()),
      options: ((typeof options !== "undefined" && options !== null ? options.options : void 0) || null)
    };
    return ss.backbone(req);
  },
  empty: function() {
    var modelname;
    modelname = this.constructor.modelname;
    // loop through models and remove listeners from ss.event
    for (_i = 0, _len = this.models.length; _i < _len; _i++) {
      model = this.models[_i];
      model.empty();
    };
    return this.reset();
  },
  initialize: function() {
    var collection, modelname;
    modelname = this.constructor.modelname;
    if (!modelname) {
      console.log("Cannot sync. You must set the name of the modelname on the Collection class");
      return delete this;
    } else {
      collection = this;
      registerCollection(collection, modelname);
      return this.on("backbone-sync-collection", function(msg) {

        // get users socketId from the engine.io transport
        var socketId, _ref;
        socketId = (typeof eio !== "undefined" && eio !== null ? (_ref = eio.socket) != null ? _ref.id : void 0 : void 0) || null;
        if (socketId === null) { 
          console.log("ss-backbone error: socketId not set in engine.io transport");
        }

        if (msg.method === "create") {
          //register new model
          // check if model is already in the collection with a different cid. using this.get(cid) doesn't work
          // As of BB 0.9.9 byCid has been removed and just uses the get method (which falls back to cid)
          //var prevModel = this.get(msg.cid); 

          // check if the request socketId matches user socketId and if so add a special attribute to model so views will know this model was added by this user/session on creation
          if (String(msg.reqSocketId) === String(socketId)) {
            msg.model.createdByUser = true;
          }

          // only attempt to find an existing model by cid if the original request came from this client (using socketId as the identifier)
          // otherwise if someone else did the create, then cid may actually already exist in this collection but for a different model.
          if ((msg.cid !== undefined) && (String(msg.reqSocketId) === String(socketId))) {
            var prevModel = this._byCid[msg.cid];
          }

          if (prevModel !== undefined) {
            prevModel.set(msg.model);
            registerModel(prevModel, msg.modelname, msg.model._id);
          }
          else {
            this.add(msg.model);
            // grab new model from collection
            var newModel = this.get(msg.model._id);
            registerModel(newModel, msg.modelname, msg.model._id);
          }
          return this.trigger("collection:create", msg.model._id);
        }

        // confirm handler. for models that may or maynot already exist on client. if it exists then update, otherwise register and add to collection
        if (msg.method === "confirm") {
          // check if model already exists in collection and update. else register new model
          var currentModel = this.get(msg.id);
          if (currentModel !== undefined) {
            currentModel.set(msg.model);
            currentModel.serverAttributesChanged(msg.model);
          }
          else {
            this.add(msg.model);
            var newModel = this.get(msg.id);
            if (newModel === undefined) return;
            registerModel(newModel, msg.modelname, msg.id);
            return this.trigger("collection:create", msg.model._id);
          }
        }

        if (msg.method === "read") {
          this.add(msg.models);
          // trigger the collection:read event on the collection passing any additional 'options' provided with the message sent from server
          return this.trigger("collection:read", msg.options);
        }
      });
    }
  }
});