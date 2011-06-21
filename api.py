# ***** BEGIN LICENSE BLOCK *****
# Version: MPL 1.1/GPL 2.0/LGPL 2.1
#
# The contents of this file are subject to the Mozilla Public License Version
# 1.1 (the "License"); you may not use this file except in compliance with
# the License. You may obtain a copy of the License at
# http://www.mozilla.org/MPL/
#
# Software distributed under the License is distributed on an "AS IS" basis,
# WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
# for the specific language governing rights and limitations under the
# License.
#
# The Original Code is the Mozilla Push Notifications Server. 
#
# The Initial Developer of the Original Code is
# Mozilla Corporation.
# Portions created by the Initial Developer are Copyright (C) 2011
# the Initial Developer. All Rights Reserved.
#
# Contributor(s):
#  Shane da Silva <sdasilva@mozilla.com>
#
# Alternatively, the contents of this file may be used under the terms of
# either the GNU General Public License Version 2 or later (the "GPL"), or
# the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
# in which case the provisions of the GPL or the LGPL are applicable instead
# of those above. If you wish to allow use of your version of this file only
# under the terms of either the GPL or the LGPL, and not to allow others to
# use your version of this file under the terms of the MPL, indicate your
# decision by deleting the provisions above and replace them with the notice
# and other provisions required by the GPL or the LGPL. If you do not delete
# the provisions above, a recipient may use your version of this file under
# the terms of any one of the MPL, the GPL or the LGPL.
#
# ***** END LICENSE BLOCK *****

import base64
from httplib import HTTPConnection
import json

class ClientAgentAPI(object):
    """Synchronous API for making HTTP requests to the Client Agent.

    This is intended to be used for testing purposes.

    """

    def __init__(self, server_address, credentials):
        self.conn = HTTPConnection(server_address[0], server_address[1])
        self.auth_headers = {'Authorization':
            'Basic ' + base64.b64encode(credentials[0] + ':' + credentials[1])
        }

    def new_queue(self):
        """Creates a new queue.
        
        The Client Agent will return a random queue name from which messages
        can be consumed.
        
        """
        try:
            self.conn.request(
                'POST',
                '/1.0/new_queue',
                '',
                self.auth_headers,
            )

            response = self.conn.getresponse()
            print response.status

            if response.status == 200:
                result = json.loads(response.read())
                result['queue_id'] = result['queue_id'].encode('ascii')
                return result
        finally:
            self.conn.close()

        return False

    def new_subscription(self, token):
        """Opens the specified token as a new subscription.

        Adds the specified token to the authenticated user's 
        list of open subscriptions.
        
        """
        payload = json.dumps({'token': token})

        try:
            self.conn.request(
                'POST',
                '/1.0/new_subscription',
                payload,
                self.auth_headers,
            )

            response = self.conn.getresponse()
            return response.status == 200
        finally:
            self.conn.close()

        return False

    def remove_subscription(self, token):
        """Cancels the specified subscription token.

        This prevents any messages from being sent via that token.
        """
        payload = json.dumps({'token': token})

        try:
            self.conn.request(
                'POST',
                '/1.0/remove_subscription',
                payload,
                self.auth_headers,
            )

            response = self.conn.getresponse()
            return response.status == 200
        finally:
            self.conn.close()

        return False

    def broadcast(self, message):
        """Broadcasts a message to all clients owned by the authenticated user.
       
        Note this does not make a well-formed JSON string. The caller is
        responsible for sending a JSON string with the correct fields.
        """
        try:
            self.conn.request(
                'POST',
                '/1.0/broadcast',
                message,
                self.auth_headers,
            )

            response = self.conn.getresponse()

            if response.status == 200:
                return True
        finally:
            self.conn.close()

        return False

