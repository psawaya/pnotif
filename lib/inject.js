// This is a work-in-progress jetpack alternative to injector.js.
const {Ci,components} = require("chrome");


const pageMod = require("page-mod");
const tabs = require("tabs");
const windows = require("windows");
const xpcom = require("xpcom");

Injector = {
    actions: [],
    actionListenerSetUp: false,
    injectToNavigator: function injectNavigator(moduleName, func, onAttach) {
        Injector.injectToWindow('navigator.' + moduleName, func, onAttach);
    },
    injectToWindow: function inject(moduleName, func, onAttach) {
        onAttach = onAttach ? onAttach : function(){};
        pageMod.PageMod({
            include: '*',
            contentScript: 'unsafeWindow.' + moduleName + " = " + func.toString() + '()',
            contentScriptWhen: 'end',
            onAttach: onAttach
        });
    },
    registerAction: function registerAction(newAction) {
        this.actions.push(newAction);
        
        var injectorObj = this;
        
        if (!this.actionListenerSetUp) {
            tabs.on('open',function(tab) {
                tab.on('ready',function() {
                    console.log('ready!');
                    for (var action in injectorObj.actions) {
                        // console.log(action);
                        injectorObj.actions[action]();
                    }
                });
            });
            actionListenerSetUp = true;
        }
    }
};

exports.Injector = Injector;