const https = require('https');

const NORDVPN_SERVER = 'https://zwyr157wwiu6eior.com/server';
const ERROR_MSG_GET_SERVERS_FAILED = 'this.getServers() threw an error';
const ERROR_MSG_SERVER_LIST_NOT_JSON_FORMAT = 'Error! Servers list should be in JSON format but it isn\'t';
let SERVER_LIST = './shared/config.json';


function getServers(data) {
    try {
        let servers = [];

        if (typeof data !== 'undefined' && data !== null) {
            console.log('How many servers do we have? :', data.length);
            for (let index = 0, len = data.length; index < len; index++) {
                console.log('data[index].domain === ', data[index].domain);
                if (data[index].domain !== '') {
                    servers.push(data[index].domain);
                }
            }
            servers.sort();
        }

        return servers;
    } catch (err) {
        console.error('getServer(data) ERROR:', err);
        return [];
    }
}

class NordVpnServerList {
    // "http://ross@socialmainst.com:Kingandre911@de100.nordvpn.com:80"
    private PROXY_CONFIG: string = 'http://ross@socialmainst.com:Kingandre911@';

    private fs = require('fs');
    private path = require('path');

    public getServerListFilename() {
        return SERVER_LIST;
    }

    public updateServerList() {

        SERVER_LIST = this.path.dirname(__filename) + '/config.json';
        //console.log(SERVER_LIST);

        try {
            this.fs.unlink(SERVER_LIST, (err) => {
                if (err) {
                    console.warn(SERVER_LIST + ' does not exist:', err);
                } else {
                    // console.log('successfully deleted :', SERVER_LIST);
                }
                this.getServersFromNordVPN();
            });
        } catch(err) {
            console.error('updateServerList() catch(err):', err);
            this.getServersFromNordVPN();
        }
    }

    private getServersFromNordVPN() {
        let parsed;
        let serverList;

        let logger = this.fs.createWriteStream(SERVER_LIST, {
            flags: 'a' // 'a' means appending (old data will be preserved)
        });

        logger.on('open', function (fd) {
            https.get(NORDVPN_SERVER, (response) => {
                let body = '';

                response.on('data', function (d) {
                    body += d;
                });

                response.on('end', function () {

                    parsed = JSON.parse(body);
                    serverList = getServers(parsed);
                    const fileHeader: string = 
                    '{' + "\n" +
                    '    "defaultTimeout": 5000,' + "\n" +
                    '    "port": 8000,' + "\n" +
                    '    "repairTime": 600,' + "\n" +
                    '    "blockTimeout": 3600,' + "\n" +
                    '    "logLevel": "INFO",' + "\n" +
                    '    "graceTime": 150,' + "\n" +
                    '    "logging": {' + "\n" +
                    '        "appenders": [' + "\n" +
                    '            { "type": "console" }' + "\n" +
                    '        ],' + "\n" +
                    '        "replaceConsole": true' + "\n" +
                    '    },' + "\n" +
                    '    "proxies": [' + "\n";
                    '  '
                    const fileFooter: string =
                    '    ]' + "\n" +
                    '}';

                    logger.write(fileHeader)

                    for (let index = 0; index < serverList.length; index++) {
                        if (index === serverList.length -1) {
                            logger.write('        "http://ross@socialmainst.com:Kingandre911@' + serverList[index] + ':80"' + "\n");
                        } else {
                            logger.write('        "http://ross@socialmainst.com:Kingandre911@' + serverList[index] + ':80",' + "\n");
                        }
                    }

                    logger.write(fileFooter)

                    logger.end() // close string

                });

            }).on('error', (e) => {
                console.error(e);
            });
        });
    }
}

module.exports = new NordVpnServerList();
