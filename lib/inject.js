// This is a work-in-progress jetpack alternative to injector.js.
const {Ci,components} = require("chrome");

const dataDir = require("self").data;
const observers = require("observer-service");
const tabs = require("tabs");
const { Worker } = require("content");
const windows = require("windows");
const xpcom = require("xpcom");
const xulApp = require("xul-app");

// Lifted from page-mod.js
// Whether or not the host application dispatches a document-element-inserted
// notification when the document element is inserted into the DOM of a page.
// The notification was added in Gecko 2.0b6, it's a better time to attach
// scripts with contentScriptWhen "start" than content-document-global-created,
// since libraries like jQuery assume the presence of the document element.
const HAS_DOCUMENT_ELEMENT_INSERTED =
        xulApp.versionInRange(xulApp.platformVersion, "2.0b6", "*");
const ON_CONTENT = HAS_DOCUMENT_ELEMENT_INSERTED ? 'document-element-inserted' :
                   'content-document-global-created';

Injector = function() {
    let actions = [];
    let actionListenerSetUp = false;
    let haveInit = false;
    let injections = [];
    
    function doInject(domObj) {
        let window = HAS_DOCUMENT_ELEMENT_INSERTED ? domObj.defaultView : domObj;
        if (!window) return;
        
        for (let injectIdx in injections)
            doInjectObj(window,injections[injectIdx].moduleName,injections[injectIdx].obj);
        
        for (let action in actions)
            actions[action]();
    }
    function doInjectObj(window,moduleName,obj) {
        let contentScript = 'unsafeWindow.' + moduleName + ' = {};\n';
        
        for (let func in obj) {
            if (typeof obj[func] !== 'function') continue;

            let injectFuncStr =  'function() {                  \n \
                    var callbacks = handleCallbacks(arguments); \n \
                    self.postMessage({                          \n \
                        "func" : "' + func + '",                \n \
                        "args" : arguments,                     \n \
                        "callbacks" : callbacks                 \n \
                    }); }';

            contentScript += 'unsafeWindow.' + moduleName + '.' + func + ' = ' + injectFuncStr + ';\n';
        }
        // Creating one worker per injection should avoid namespace collisions
        let worker = Worker({
            window: window.wrappedJSObject,
            contentScript: contentScript,
            contentScriptFile: dataDir.url('injectCallback.js')
        });
        
        worker.on('message',function(msg) {
            // TODO: there has to be a cleaner way of doing this.
            let args = [];
            for (let argPos in msg.args)
                args[argPos] = msg.args[argPos];
            console.log('callbacks');
            
            for (let callbackPos in msg.callbacks) {
                console.log(callbackPos);
                console.log(msg.callbacks[callbackPos]);
                var callbackID = msg.callbacks[callbackPos];
                args[callbackPos] = function() {
                    // TODO: again, there has to be a cleaner way of doing this.
                    let args = [];
                    for (let argPos in arguments)
                        args[argPos] = arguments[argPos];
                    worker.port.emit('onCallback',{
                        callbackID: callbackID,
                        args: args
                    });
                };
            }
            obj[msg.func].apply(obj,args);
        });
    }
    function init() {
        observers.add(ON_CONTENT, doInject);
        haveInit = true;
    }
    return {
        injectObj: function injectObj(moduleName,obj) {
            injections.push({
                moduleName: moduleName,
                obj: obj
            });
            
            if (!haveInit)
                init();
        },
        registerAction: function registerAction(newAction) {
            actions.push(newAction);
        
            if (!haveInit)
                init();
        }
    }
}();

exports.Injector = Injector;