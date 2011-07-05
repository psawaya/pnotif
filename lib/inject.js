// This is a work-in-progress jetpack alternative to injector.js.
const {Ci,components} = require("chrome");

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
        
        for (let action in actions)
            actions[action]();
        
        if (!window) return;    
        for (let injectionIdx in injections) {
            let injection = injections[injectionIdx];
            let contentScript = 'unsafeWindow.' + injection.where + ' = ' + injection.func.toString() + '()\n';
        
            let worker = Worker({
                window: window.wrappedJSObject,
                contentScript: contentScript,
            });

            worker.once('detach', function detach() {
                worker.destroy();
            });

            injection['onAttach'](worker);
        }
    }
    function init() {
        observers.add(ON_CONTENT, doInject);
        haveInit = true;
    }
    return {
        injectToNavigator: function injectNavigator(moduleName, func, onAttach) {
            Injector.injectToWindow('navigator.' + moduleName, func, onAttach);
        },
        injectToWindow: function inject(moduleName, func, onAttach) {
            onAttach = onAttach ? onAttach : function(){};        
            injections.push({
                where: moduleName,
                func: func,
                onAttach: onAttach
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