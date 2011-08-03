const dataDir = require("self").data;
const inject = require('inject');
const notifications = require("notifications");
const panel = require("panel");
const pageMod = require("page-mod");
const tabs = require("tabs");
const url = require("url");
const widgets = require("widget");
const windows = require("windows")

const amqp = require("amqp091/connection");
const Engine = require("./engine").Engine;

const {Cc,Ci,Cu} = require("chrome");

const Svc = Cu.import("resource://services-sync/util.js").Svc;
const Weave = Cu.import("resource://services-sync/main.js").Weave;

const ServicesRes = Cu.import("resource://services-sync/resource.js");
const AsyncResource = ServicesRes.AsyncResource;
// FIXME: BrokenBasicAuthenticator works only for ASCII passwords
const BasicAuthenticator = ServicesRes.BrokenBasicAuthenticator;


// Utter hackery, necessary to access the window.btoa/atob function.
// source: http://cat-in-136.blogspot.com/2010/08/tip-calling-windowatob-and-btoa-from.html
var win = require("window-utils").windowIterator().next();
var btoa = win.QueryInterface(Ci.nsIDOMWindowInternal).btoa;
var atob = win.QueryInterface(Ci.nsIDOMWindowInternal).atob;
function utf8_to_b64( str ) {
    return btoa(unescape(encodeURIComponent( str )));
}
function b64_to_utf8( str ) {
    return decodeURIComponent(escape(atob( str )));
}

var mainWindow = Cc["@mozilla.org/appshell/window-mediator;1"]
                     .getService(Ci.nsIWindowMediator);

const TOKEN_LENGTH = 32;
const ENCR_KEY_LENGTH = 32;
const HMAC_KEY_LENGTH = 32;

const REGISTER_APP = "services.notifications.register_app";

// FIXME: In the future, don't use global variables to store the last
// set of auth params/callback function.
var authParams = {};
var authCallback = null;

var canHidePanel = true;

var haveLoggedIn = false;

function initUI() {
    var authPanel = panel.Panel({
        contentURL: dataDir.url('auth.html'),
        contentScriptFile: dataDir.url('auth.js'),
        contentScriptWhen: 'ready',
        onMessage: function(msg) {
            canHidePanel = true;
            authPanel.hide();
            // FIXME: Get host (and port) from worker.contentURL instead of passing it through message.
            if (msg.authDecision)
                Client.authSuccess(authParams,authCallback,authParams.contentHost);
        },
        onHide: function() {
            // Cheesy way of making sure the panel doesn't disappear when you click off.
            if (!canHidePanel)
                this.show();
        },
    });
    
    function handleAuthMessage() {
        canHidePanel = false;
        authPanel.show();
    }
    
    inject.Injector.injectObjNavigator('pushNotifications', {
        requestPermissions: function requestPermissions(window, params, callbackFunc) {
            authParams = params;
            authParams['contentHost'] = window.location;
            authCallback = callbackFunc;
            if (haveLoggedIn)
                handleAuthMessage();
            else
                showLoginBox(true);
        }
    });
}

function showLoginBox(authAfterward) {
    canHidePanel = false;
    var loginPanel = panel.Panel({
        contentURL: dataDir.url('login.html'),
        contentScriptFile: dataDir.url('login.js'),
        contentScriptWhen: 'ready',
        onMessage: function(msg) {
            canHidePanel = true;
            this.hide();
            Client.username = msg['username'];
            Client.password = msg['password'];
            Client.createUserQueue(function() {
                haveLoggedIn = true;            
                if (authAfterward)
                    handleAuthMessage();
            });
        },
        onHide: function() {
            // Cheesy way of making sure the panel doesn't disappear when you click off.
            if (!canHidePanel)
                this.show();
        },
    });
    loginPanel.show();
}


var Client = {
    init: function init() {
        this.Prefs = {};
        this.Prefs["clientAgentURL"] = 'http://localhost:8000/';//"http://push1.mtv1.dev.svc.mozilla.com:8000/";
        this.Prefs["postOfficeURL"] = 'http://localhost:8000/';//http://push1.mtv1.dev.svc.mozilla.com:8000/";
        
        // Load subscriptions/queueObj from disk first.            
        Engine.loadSubscriptions(function() {
            if (Engine.getQueueObj()) {
                haveLoggedIn = true;
                Client.connectAMQP(function() {});
            }
        });
    },

    authSuccess: function authSuccess(params,callback,contentHost) {    
        var subscription = {
          app_name: params.app_name,
          account: params.account,
          host: contentHost, // This is the host (and port) of the current web app
          silent: false,
          token: btoa(Weave.Utils.generateRandomBytes(TOKEN_LENGTH)),
          encryptionKey: btoa(Weave.Utils.generateRandomBytes(ENCR_KEY_LENGTH)),
          hmacKey: btoa(Weave.Utils.generateRandomBytes(HMAC_KEY_LENGTH))
        };
        var response = {
          token: subscription.token,
          encryptionKey: subscription.encryptionKey,
          hmacKey: subscription.hmacKey,
          serverURL: this.Prefs["postOfficeURL"]
        };
        var regAppCallback = function () {
          if(!callback) {
            Weave.Svc.Obs.notify("services:notifications:newerror", 
                                 REG_CALLBACK);
            return;
          }
          callback(response, subscription);
        };

        // Register the app with the token on the server side.
        Client.regAppSubscription(subscription, regAppCallback);
    },
    
    connectAMQP: function connectAMQP(successCallback) {
        var queueObj = Engine.getQueueObj();
        console.log("queueName = " + queueObj.queueName);
        var conn = new amqp.Connection(queueObj.queueHost, queueObj.queuePort);
        conn.open(function() {
          console.log('AMQP connection success!');
          conn.createChannel(function(channel) {
            channel.consume("notifsConsumer", function(message, deliveryTag) {
              try {
                Client.onConsumeNotification(message, deliveryTag);
                channel.basic_ack(deliveryTag);
              } catch (ex) {
                console.log("BAD: " + JSON.stringify(ex) + "\n");
              }
            }, queueObj.queueName);
          if (successCallback)
              successCallback();
          });
        });
    },
    
    createUserQueue: function createUserQueue(successCallback) {
        var resourceURL = this.Prefs['clientAgentURL'] + "1.0/new_queue";
        var res = new AsyncResource(resourceURL);
    
        res.authenticator = this.getAuthenticator();

        console.log(resourceURL);
        
        res.post("", function(error, result) {
            if (error || !result.success) { 
              console.log("Couldn't POST!");
              console.log(error);
              console.log(result);
              //TODO: Real error handling.
              return;
            }

            var agentResponse = JSON.parse(result);

            // FIXME: Config push1 to report its hostname properly so that we don't need to hardcode this. (!)
            Engine.setQueueObj({
                queueHost: 'localhost',//'push1.mtv1.dev.svc.mozilla.com',//agentResponse.host,
                queuePort: agentResponse.port,
                queueName: agentResponse.queue_id
            });
            
            Client.connectAMQP(successCallback);
        });
    },
    

    decryptMessageBody: function decryptMessageBody(body, engine) {
      var encryptionKey;

      // Get the right encryption key based on message type
      if (body.token) {
        subscription = Engine.getSubscription(body.token);
        encryptionKey = subscription.encryptionKey;
      } else {
        encryptionKey = Engine.getBroadcastKeys().encryption;
      }

      var clearText;
      try {
        clearText = Weave.Svc.Crypto.decrypt(
          body.ciphertext,
          encryptionKey,
          body.IV
        );
      } catch (ex) {
        Weave.Svc.Obs.notify("services:notifications:newerror", 
                               DECRYPT_MESSAGE);
        return;
      }
      var payload;
      try {
        payload = JSON.parse(clearText);
      } catch (ex) {
        Weave.Svc.Obs.notify("services:notifications:newerror", 
                               DECRYPT_MESSAGE);
        return;
      }

      // Cloning isn't really necessary, but it doesn't cost much
      var decryptedBody = JSON.parse(JSON.stringify(body));

      // Remove attributes related to encryption and replace with payload
      delete decryptedBody.ciphertext;
      delete decryptedBody.IV;
      decryptedBody.payload = payload;

      return decryptedBody;
    },

    displayNotification: function displayNotification(notificationBody) {
      notifications.notify({
          title: notificationBody.payload.title,
          text: notificationBody.payload.text
      });
    },
    
    getAuthenticator: function getAuthenticator() {
        return new BasicAuthenticator({
            'username': this.username,
            'password': this.password
        });
    },

    onConsumeNotification: function onConsumeNotification(messageText, deliveryTag) {        
      // Make sure we have an engine
      var engine = Weave.Engines.get("notifications");

      // TODO: Encapsulate message json and body in message object. Decapsulation happens
      // in this message.

      // Parse message and its body
      var message;
      var body;
      try {
        message = JSON.parse(messageText);
        body = JSON.parse(message.body);
      } catch (ex) {
        Weave.Svc.Obs.notify("services:notifications:newerror", 
                             NOTIFICATION_BODY_PARSE);
        return;
      }

      // Ignore any invalid notifications
      if (!Client.verifyMessage(message, body, engine)) {
        console.log('Invalid notification, verification failed.');
        return;
      }

      var decryptedBody = Client.decryptMessageBody(body, engine);

      // Handle based on the type of message
      if (decryptedBody.token) {
        Client.displayNotification(decryptedBody);
      } else {        
        // TODO: broadcast message.
      }
    },

    regAppSubscription: function regAppSubscription(subscription, callback) {
      console.log("Registering subscription...\n");
      var packetURL = Client.Prefs["clientAgentURL"] + "1.0/new_subscription";
      var body = {token: subscription.token};
      var res = new AsyncResource(packetURL);
      res.authenticator = this.getAuthenticator();
      
      res.post(body, function(error, result) {
        if (error || !result.success) {
          Weave.Svc.Obs.notify("services:notifications:newerror", REGISTER_APP);
          return;
        }
        // var engine = Weave.Engines.get("notifications");
        Engine.addSubscription(subscription.token, subscription);
        callback();
      });
    },
        
    verifyMessage: function verifyMessage(message, body, engine) {
      // Determine which HMAC we should compare against
      var hmacKey;
      if (!body.token) {
        hmacKey = Engine.getBroadcastKeys().hmac;
      } else {
        subscription = Engine.getSubscription(body.token);
        if (!subscription) {
          return false;
      }
        hmacKey = subscription.hmacKey;
      }
      // Check HMAC before we do any more processing
      // TODO: Use KeyBundle HMAC hasher so we're not creating objects each time
      var hmacKeyObj = Weave.Utils.makeHMACKey(atob(hmacKey));
      var hasher = Weave.Utils.makeHMACHasher(Ci.nsICryptoHMAC.SHA256, hmacKeyObj);
      var hmac = btoa(Weave.Utils.digestBytes(message.body, hasher));

      // Ignore notifications with invalid HMACs
      if (hmac != message.HMAC) {
        return false;
      }

      return true;
  }
}

initUI();
Client.init();

if (!Engine.getQueueObj()) {
    // First time the extension has been run, we
    // login to the notifications server.
    showLoginBox();
}