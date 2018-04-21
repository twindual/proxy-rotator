'use strict';

var request     = require('request'),
    querystring = require('querystring'),
    parseUrl    = require('url').parse,
    logger      = require('log4js'),
    express     = require('express'),
    bodyParser  = require('body-parser'),
    fs          = require('fs'),
    app         = express(),
    server,
    Proxies     = require('./proxymanager'),
    Config      = require('./config'),
    startedAt   = new Date()

logger.configure(Config.logging)
logger = logger.getLogger('proxy-rotator')
logger.setLevel(Config.logLevel || "INFO")

// get config settings
var Port            = Config.port, 
    DefaultTimeout  = Config.defaultTimeout,
    BindAddress     = Config.bindAddress,
    GraceTime       = Config.graceTime || 0,
    NextReqTimeout  = Config.nextRequestTimeout || 2000,
    BlockErrors     = ['ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ESOCKETTIMEDOUT', 'ECONNREFUSED']

app.use(bodyParser.json());

app.get('/status', sendStatus)
app.get('/proxies', sendProxies)
app.post('/admin', admin)
app.get('/next_proxy', nextProxy)
app.get('/', handleRequest)

if(fs.existsSync('.proxies.tmp')) {
  logger.info('restoring previous state')
  fs.readFile('.proxies.tmp', function(err, json) {
    if(err) return logger.error(err)
    var dates = ['blocked', 'broken', 'lastRequest']
    Proxies.setList(JSON.parse(json))
    for(var i = 0; i < Proxies.list.length; i++) {
      var proxy = Proxies.list[i]
      proxy.inUse = false
      for(var key in proxy) {
        if(dates.indexOf(key) !== -1 && proxy[key] !== false) {
          proxy[key] = new Date(proxy[key])
        }
      }
    }
  })
}

setInterval(reportStatus, 10000)


function nextProxy(req, res) {

}

function admin(req, res) {

  if(!req.body) {
    return res.send('no command sent')
  }

  if(req.body.status) {
    return sendStatus(req, res)
  } else if(req.body.proxies) {
    return sendProxies(req, res)
  } else if(req.body.revive) {
    Proxies.list.forEach(function(proxy) {
      proxy.broken = false
      proxy.blocked = false
    })
    res.end('proxies revived')
  } else if(req.body.removeProxy) {
    Proxies.setList(Proxies.list.filter(function(proxy) {
      return proxy.proxy !== req.body.removeProxy
    }))
    res.end('proxy ' + req.body.removeProxy + ' removed')
  } else {
    res.end('unknown command')
  }
}

function reportStatus() {
  var status = Proxies.status()  
  status['wait (s)'] = Proxies.waitTime? Math.round(Proxies.waitTime / 1000): 0
  logger.info(JSON.stringify(status))
}

function sendProxies(req, res) {
  res.end(JSON.stringify(Proxies.list))
}
function sendStatus(req, res) {
  var status = Proxies.status()
  status.startedAt = startedAt
  status['wait (s)'] = Proxies.waitTime? Math.round(Proxies.waitTime / 1000): 0
  status.config = Config
  var firstBlocked = Proxies.firstBlocked()
  if(firstBlocked) {
    firstBlocked = new Date(firstBlocked.blocked.getTime() + (Config.blockTimeout*1000))
    status['next block release'] = firstBlocked.toLocaleString('de')
  }
  res.send(status)
}

/**
 * Handle the incoming request.
 */
function handleRequest (req, res) {
  let query = querystring.parse(req.url.substring(2));
  let proxy;
  let url;
  let timeout = (+query.timeout) || DefaultTimeout

  if(!query.url) {
    return res.end(JSON.stringify({
      urls: {
        '/status': 'get the service status',
        '/proxies': 'get the proxy status',
        '/?url=[url]': 'send a request for a url',
        '/next_proxy': 'get the next available proxy'
      }
    }));
  }

  url = parseUrl(query.url, true);

  if(!url.host) {
    url = parseUrl('http://' + query.url)
    if(!url.host) return res.send(500).end('supply a proper url, for example: url=google.de')
  }

  if(Proxies.blocked()) {
    return res.status(503).end('all proxies are blocked')
  }

  proxy = Proxies.nextProxy(url.host, function(err, proxy) {
    // console.log('nextProxy()');
    if(err) {
      if(err === 'ALL_BLOCKED') {
        res.status(503).end('all proxies are blocked')
      } else {
        res.status(503).end('all proxies are broken')
      }
      return
    }

    logger.debug('%s (%s)', query.url, proxy)

    // handle grace time for preventing blocks or/and send the request
    if (typeof proxy.lastRequest === 'undefined' || proxy.lastRequest === null) { proxy.lastRequest = 0; }

    if(GraceTime !== 0 && proxy.lastRequest && Date.now() < proxy.lastRequest.getTime() + GraceTime) {
      var wait = proxy.lastRequest.getTime() + GraceTime - Date.now()
      logger.debug('have to wait for %sms to prevent a block on proxy %s', wait, proxy.proxy)
      Proxies.waitTime+= wait
      setTimeout(function() {
        sendRequest(proxy, url, timeout, req, res)
      }, wait)
    } else {
      sendRequest(proxy, url, timeout, req, res)
    }
  })
}

/**
 * Send the request over the chosen proxy.
 */
function sendRequest(proxy, url, timeout, req, res) {
  
  // -- Example code --
  //var cookieString = 'hl=en_US; expires=' + new Date(new Date().getTime() + 86409000);
  //var cookie = request.cookie(cookieString);
  //var j = request.jar();
  //j.setCookie(cookie, url);

  let cookie = "'yuv=vEkvg6d5q9OY12DNI_a1Vo-ZCypAA5wAkGh7mppDddayDFEbD2Dt-RLoO5AGmJ-InZIyjV-KzE5_0O81-j7cNQQGLAmzec4A; Domain=.yelp.com; Max-Age=630720000; Path=/; expires=Thu, 15-Apr-2038 18:06:44 GMT', " + 
    "'bse=c708e0f5634147f784d2274ac22d09bd; Domain=.yelp.com; Path=/; HttpOnly'," + 
    "'ssi=; Domain=.yelp.com; Max-Age=0; Path=/; expires=Wed, 31-Dec-97 23:59:59 GMT'," +
    "'recentlocations=Los+Angeles%2C+CA%3B%3B; Domain=.yelp.com; Path=/'," +
    "'location=%7B%22max_longitude%22%3A+-122.124632%2C+%22entity_id%22%3A+1668%2C+%22min_longitude%22%3A+-122.2221965%2C+%22neighborhood%22%3A+%22%22%2C+%22address1%22%3A+%22%22%2C+%22address2%22%3A+%22%22%2C+%22address3%22%3A+%22%22%2C+%22min_latitude%22%3A+47.5713619%2C+%22county%22%3A+null%2C+%22unformatted%22%3A+%22Bellevue%2C+WA%22%2C+%22borough%22%3A+%22%22%2C+%22polygons%22%3A+null%2C+%22city%22%3A+%22Bellevue%22%2C+%22isGoogleHood%22%3A+false%2C+%22language%22%3A+null%2C+%22zip%22%3A+%22%22%2C+%22country%22%3A+%22US%22%2C+%22provenance%22%3A+%22YELP_GEOCODING_ENGINE%22%2C+%22longitude%22%3A+-122.17341425000001%2C+%22display%22%3A+%22Bellevue%2C+WA%22%2C+%22confident%22%3A+null%2C+%22state%22%3A+%22WA%22%2C+%22latitude%22%3A+47.61030795%2C+%22usingDefaultZip%22%3A+false%2C+%22max_latitude%22%3A+47.649254%2C+%22accuracy%22%3A+4%7D; Domain=.yelp.com; Max-Age=630720000; Path=/; expires=Thu, 15-Apr-2038 18:06:44 GMT'," +
    "'sc=528645d352; Path=/'";
  
  cookie = "yuv=7__qpiPxj0-v7DSX8jUw_QTPHXb4_LsxqaqpKwLy1k22RvLoqOv_vrV2DsdrxFfaRuPvhsbIWCr8TDmTF0T1xtuLq3ViCGbY; bse=; sc=528645d352; ssi=; hl=en_US; 'recentlocations=Kirkland%2C+WA%3B%3B; location=%7B%22max_longitude%22%3A+-122.124632%2C+%22entity_id%22%3A+1668%2C+%22min_longitude%22%3A+-122.2221965%2C+%22neighborhood%22%3A+%22%22%2C+%22address1%22%3A+%22%22%2C+%22address2%22%3A+%22%22%2C+%22address3%22%3A+%22%22%2C+%22min_latitude%22%3A+47.5713619%2C+%22county%22%3A+null%2C+%22unformatted%22%3A+%22Bellevue%2C+WA%22%2C+%22borough%22%3A+%22%22%2C+%22polygons%22%3A+null%2C+%22city%22%3A+%22Bellevue%22%2C+%22isGoogleHood%22%3A+false%2C+%22language%22%3A+null%2C+%22zip%22%3A+%22%22%2C+%22country%22%3A+%22US%22%2C+%22provenance%22%3A+%22YELP_GEOCODING_ENGINE%22%2C+%22longitude%22%3A+-122.17341425000001%2C+%22display%22%3A+%22Bellevue%2C+WA%22%2C+%22confident%22%3A+null%2C+%22state%22%3A+%22WA%22%2C+%22latitude%22%3A+47.61030795%2C+%22usingDefaultZip%22%3A+false%2C+%22max_latitude%22%3A+47.649254%2C+%22accuracy%22%3A+4%7D;";
    
  let cookie_yelp = [
    "hl=en_US; location=%7B%22max_longitude%22%3A+-122.124632%2C+%22entity_id%22%3A+1668%2C+%22min_longitude%22%3A+-122.2221965%2C+%22neighborhood%22%3A+%22%22%2C+%22address1%22%3A+%22%22%2C+%22address2%22%3A+%22%22%2C+%22address3%22%3A+%22%22%2C+%22min_latitude%22%3A+47.5713619%2C+%22county%22%3A+null%2C+%22unformatted%22%3A+%22Bellevue%2C+WA%22%2C+%22borough%22%3A+%22%22%2C+%22polygons%22%3A+null%2C+%22city%22%3A+%22Bellevue%22%2C+%22isGoogleHood%22%3A+false%2C+%22language%22%3A+null%2C+%22zip%22%3A+%22%22%2C+%22country%22%3A+%22US%22%2C+%22provenance%22%3A+%22YELP_GEOCODING_ENGINE%22%2C+%22longitude%22%3A+-122.17341425000001%2C+%22display%22%3A+%22Bellevue%2C+WA%22%2C+%22confident%22%3A+null%2C+%22state%22%3A+%22WA%22%2C+%22latitude%22%3A+47.61030795%2C+%22usingDefaultZip%22%3A+false%2C+%22max_latitude%22%3A+47.649254%2C+%22accuracy%22%3A+4%7D; recentlocations=Los+Angeles%2C+CA%3B%3B;", // Kirkland, WA
    //"hl=en_US; location=%7B%22max_longitude%22%3A+-73.7938%2C+%22entity_id%22%3A+1208%2C+%22min_longitude%22%3A+-74.1948%2C+%22neighborhood%22%3A+%22%22%2C+%22address1%22%3A+%22%22%2C+%22address2%22%3A+%22%22%2C+%22address3%22%3A+%22%22%2C+%22min_latitude%22%3A+40.5597%2C+%22county%22%3A+null%2C+%22unformatted%22%3A+%22New+York%2C+NY%22%2C+%22borough%22%3A+%22%22%2C+%22polygons%22%3A+null%2C+%22city%22%3A+%22New+York%22%2C+%22isGoogleHood%22%3A+false%2C+%22language%22%3A+null%2C+%22zip%22%3A+%22%22%2C+%22country%22%3A+%22US%22%2C+%22provenance%22%3A+%22YELP_GEOCODING_ENGINE%22%2C+%22longitude%22%3A+-74.0072%2C+%22display%22%3A+%22New+York%2C+NY%2C+United+States%22%2C+%22confident%22%3A+null%2C+%22state%22%3A+%22NY%22%2C+%22latitude%22%3A+40.713%2C+%22usingDefaultZip%22%3A+false%2C+%22max_latitude%22%3A+40.8523%2C+%22accuracy%22%3A+4%7D; recentlocations=;", // Kirkland, WA
    //"hl=en_US; location=%7B%22max_longitude%22%3A+-122.2742786%2C+%22entity_id%22%3A+1258%2C+%22min_longitude%22%3A+-122.3974012%2C+%22neighborhood%22%3A+%22%22%2C+%22address1%22%3A+%22%22%2C+%22address2%22%3A+%22%22%2C+%22address3%22%3A+%22%22%2C+%22min_latitude%22%3A+47.514272%2C+%22county%22%3A+null%2C+%22unformatted%22%3A+%22Seattle%2C+WA%22%2C+%22borough%22%3A+%22%22%2C+%22polygons%22%3A+null%2C+%22city%22%3A+%22Seattle%22%2C+%22isGoogleHood%22%3A+false%2C+%22language%22%3A+null%2C+%22zip%22%3A+%22%22%2C+%22country%22%3A+%22US%22%2C+%22provenance%22%3A+%22YELP_GEOCODING_ENGINE%22%2C+%22longitude%22%3A+-122.33172002695306%2C+%22display%22%3A+%22Seattle%2C+WA%2C+United+States%22%2C+%22confident%22%3A+null%2C+%22state%22%3A+%22WA%22%2C+%22latitude%22%3A+47.60518168900742%2C+%22usingDefaultZip%22%3A+false%2C+%22max_latitude%22%3A+47.736824%2C+%22accuracy%22%3A+4%7D; recentlocations=;", // Seattle, WA
    //"hl=en_US; location=%7B%22max_longitude%22%3A+-73.7938%2C+%22entity_id%22%3A+1208%2C+%22min_longitude%22%3A+-74.1948%2C+%22neighborhood%22%3A+%22%22%2C+%22address1%22%3A+%22%22%2C+%22address2%22%3A+%22%22%2C+%22address3%22%3A+%22%22%2C+%22min_latitude%22%3A+40.5597%2C+%22county%22%3A+null%2C+%22unformatted%22%3A+%22New+York%2C+NY%22%2C+%22borough%22%3A+%22%22%2C+%22polygons%22%3A+null%2C+%22city%22%3A+%22New+York%22%2C+%22isGoogleHood%22%3A+false%2C+%22language%22%3A+null%2C+%22zip%22%3A+%22%22%2C+%22country%22%3A+%22US%22%2C+%22provenance%22%3A+%22YELP_GEOCODING_ENGINE%22%2C+%22longitude%22%3A+-74.0072%2C+%22display%22%3A+%22New+York%2C+NY%2C+United+States%22%2C+%22confident%22%3A+null%2C+%22state%22%3A+%22NY%22%2C+%22latitude%22%3A+40.713%2C+%22usingDefaultZip%22%3A+false%2C+%22max_latitude%22%3A+40.8523%2C+%22accuracy%22%3A+4%7D; recentlocations=;",  // New York, NY
    //"hl=en_US; location=%7B%22max_longitude%22%3A+-122.3550796508789%2C+%22entity_id%22%3A+1237%2C+%22min_longitude%22%3A+-122.51781463623047%2C+%22neighborhood%22%3A+%22%22%2C+%22address1%22%3A+%22%22%2C+%22address2%22%3A+%22%22%2C+%22address3%22%3A+%22%22%2C+%22min_latitude%22%3A+37.706368356809776%2C+%22county%22%3A+null%2C+%22unformatted%22%3A+%22San+Francisco%2C+CA%22%2C+%22borough%22%3A+%22%22%2C+%22polygons%22%3A+null%2C+%22city%22%3A+%22San+Francisco%22%2C+%22isGoogleHood%22%3A+false%2C+%22language%22%3A+null%2C+%22zip%22%3A+%22%22%2C+%22country%22%3A+%22US%22%2C+%22provenance%22%3A+%22YELP_GEOCODING_ENGINE%22%2C+%22longitude%22%3A+-122.41931994395134%2C+%22display%22%3A+%22San+Francisco%2C+CA%22%2C+%22confident%22%3A+null%2C+%22state%22%3A+%22CA%22%2C+%22latitude%22%3A+37.775123257209394%2C+%22usingDefaultZip%22%3A+false%2C+%22max_latitude%22%3A+37.81602226140252%2C+%22accuracy%22%3A+4%7D; recentlocations=;", // San Francisco, CA
    //"hl=en_US; location=%7B%22max_longitude%22%3A+-118.1529362%2C+%22entity_id%22%3A+1214%2C+%22min_longitude%22%3A+-118.4896057%2C+%22neighborhood%22%3A+%22%22%2C+%22address1%22%3A+%22%22%2C+%22address2%22%3A+%22%22%2C+%22address3%22%3A+%22%22%2C+%22min_latitude%22%3A+33.9547806%2C+%22county%22%3A+null%2C+%22unformatted%22%3A+%22Los+Angeles%2C+CA%22%2C+%22borough%22%3A+%22%22%2C+%22polygons%22%3A+null%2C+%22city%22%3A+%22Los+Angeles%22%2C+%22isGoogleHood%22%3A+false%2C+%22language%22%3A+null%2C+%22zip%22%3A+%22%22%2C+%22country%22%3A+%22US%22%2C+%22provenance%22%3A+%22YELP_GEOCODING_ENGINE%22%2C+%22longitude%22%3A+-118.24368000761717%2C+%22display%22%3A+%22Los+Angeles%2C+CA%22%2C+%22confident%22%3A+null%2C+%22state%22%3A+%22CA%22%2C+%22latitude%22%3A+34.052392981469445%2C+%22usingDefaultZip%22%3A+false%2C+%22max_latitude%22%3A+34.1682093%2C+%22accuracy%22%3A+4%7D; recentlocations=;", // Los Angeles, CA
  ];
  let index_cookie_yelp = Math.floor(Math.random() * cookie_yelp.length);
  console.log('index_cookie_yelp: ', index_cookie_yelp);

  //console.log('URL === ', url);
  if (url.href.indexOf('https://www.yelp.') === 0 || url.href.indexOf('https://yelp.') === 0) {
    //console.log('ITS YELP!');
//    cookie = cookie_yelp[index_cookie_yelp];
  }

  var options = {
      url: url,
      proxy: proxy.proxy,
      timeout: timeout,
      headers: {
        //'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3325.181 Safari/537.36',
        //'User-Agent': 'Google',
        // %7B%22max_longitude%22%3A+-95.177%2C+%22entity_id%22%3A+1215%2C+%22min_longitude%22%3A+-95.5423%2C+%22neighborhood%22%3A+%22%22%2C+%22address1%22%3A+%22%22%2C+%22address2%22%3A+%22%22%2C+%22address3%22%3A+%22%22%2C+%22min_latitude%22%3A+29.6057%2C+%22county%22%3A+null%2C+%22unformatted%22%3A+%22Houston%2C+TX%22%2C+%22borough%22%3A+%22%22%2C+%22polygons%22%3A+null%2C+%22city%22%3A+%22Houston%22%2C+%22isGoogleHood%22%3A+false%2C+%22language%22%3A+null%2C+%22zip%22%3A+%22%22%2C+%22country%22%3A+%22US%22%2C+%22provenance%22%3A+%22YELP_GEOCODING_ENGINE%22%2C+%22longitude%22%3A+-95.3596%2C+%22display%22%3A+%22Houston%2C+TX%2C+United+States%22%2C+%22confident%22%3A+null%2C+%22state%22%3A+%22TX%22%2C+%22latitude%22%3A+29.7541%2C+%22usingDefaultZip%22%3A+false%2C+%22max_latitude%22%3A+29.9207%2C+%22accuracy%22%3A+4%7D'
        //'User-Agent': 'request',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3325.181 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1',
        'Connection': 'keep-alive',
        'Cache-Control': 'private',
        'Cookie': cookie,
      }
    }

    proxy.inUse = true
    request.get(options, sendResponse(proxy, req, res))
           .on('error', onError(proxy, req, res, url))
}




/**
 * Send the actual response to the client.
 */
function sendResponse(proxy, req, res) {
  return function (err, response, body) {
    //Get cookies from response
    var responseCookies = response.headers['set-cookie'];
    var requestCookies = '';
        
    console.log(responseCookies);

    proxy.inUse = false
    if(GraceTime !== 0) proxy.lastRequest = new Date()
    if(err) {
      res.writeHead(500, {
        'Content-Length': err.message? err.message.length: 0,
        'Content-Type': 'text/plain',
        'x-proxy': proxy.proxy
      })
      res.status(500).end(err.message || '')
      return
    } else if(response.statusCode === 403) {
      logger.error(proxy.proxy + ' is blocked')
      proxy.blocked = new Date()
      if(Proxies.allBlocked()) {
        logger.error('all proxies are blocked')
      }
      return setTimeout(function() {
        handleRequest(req, res)
      }, NextReqTimeout)
    }
    var header = response.headers
    proxy.hits++
    header['x-proxy'] = proxy.proxy
    res.writeHead(response.statusCode, header)
    res.end(body)
  }
}

/**
 * Called when a error occurs during request, such as timeout, socket exceptions, eg.
 */
function onError(proxy, req, res, url) {
  return function (err) {
    proxy.inUse = false
    // handle timeout as Broken proxy
    if(BlockErrors.indexOf(err.code) !== -1) {
      if(!proxy.broken) {
        proxy.broken = new Date()
        proxy.errors++
        logger.warn('added ' + proxy.proxy + ' to broken list for host ' + url.host + ' (' + err.code + ')')
        if(Proxies.allBroken()) {
          logger.error('all proxies are broken')
        }
      }
    }
    else {
      logger.error(err)
    }
  }
}

/**
 * Log address and port of the running service.
 */
function serverStarted() {
  logger.info('service running at http://%s:%s', 
    server.address().address, server.address().port);
}

function shutdown() {
  logger.info('shutting down')
  server.close()
  fs.writeFile('.proxies.tmp', JSON.stringify(Proxies.list), function () {
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

if(BindAddress) {
  server = app.listen(Port, BindAddress, serverStarted)
} else {
  server = app.listen(Port, serverStarted)
}

