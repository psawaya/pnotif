// TODO: find a better way of doing this than embedding a global variable.
var __notifsCallback = function() {};
window.navigator.pushNotifications = {
            requestPermissions: function requestPermissions(params,callbackFunc) {
                __notifsCallback = callbackFunc;
                window.navigator.pushNotifications['callbackFunc'] = callbackFunc;
                params['contentHost'] = window.location.host;
                self.postMessage({ params: params, callbackFunc: callbackFunc });
            } 
};
self.port.on('execNotifsCallback', function(msg) {
  if (msg && msg.args)
        __notifsCallback.apply(window,msg.args);
});