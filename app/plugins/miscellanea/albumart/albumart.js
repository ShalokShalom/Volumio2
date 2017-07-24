'use strict';

var albumart = require('album-art');
var Q = require('kew');
var download = require('file-download');
var S = require('string');
var fs = require('fs-extra');
var uuid = require('node-uuid');
var nodetools = require('nodetools');
var mm = require('musicmetadata');

var winston = require('winston');
var logger = new (winston.Logger)({
	transports: [
		new (winston.transports.Console)(),
		new (winston.transports.File)({
			filename: '/var/log/albumart.log',
			json: false
		})
	]
});

var albumArtRootFolder = '/data/albumart/web';
var mountAlbumartFolder= '/data/albumart/folder';
var metadataAlbumartFolder= '/data/albumart/metadata';

var setFolder = function (newFolder) {
	//logger.info("Setting folder " + newFolder);
	albumArtRootFolder = S(newFolder).ensureRight('/').s+'web/';
    fs.ensureDirSync(albumArtRootFolder);

    mountAlbumartFolder= S(newFolder).ensureRight('/').s+'folder/';
    fs.ensureDirSync(mountAlbumartFolder);

    metadataAlbumartFolder= S(newFolder).ensureRight('/').s+'metadata/';
    fs.ensureDirSync(metadataAlbumartFolder);
};

var searchOnline = function (defer, web) {
	/**
	 * If we arrive to this point the file albumart has not been passed or doesn't exists
	 */

	var artist, album, resolution;

    if (web != undefined) {
		var splitted = web.split('/');

		if (splitted.length < 3) {
			defer.reject(new Error('The web link ' + web + ' is malformed'));
			return defer.promise;
		}

		if (splitted.length == 3) {
			artist = splitted[0];
			album = splitted[1];
			resolution = splitted[2];
		}
		else if (splitted.length == 4) {
			artist = splitted[1];
			album = splitted[2];
			resolution = splitted[3];
		}
	}
	else {
		defer.reject(new Error('No parameters defined'));
		return defer.promise;
	}

	/**
	 * Loading album art from network
	 */
	var folder;

	if(album)
    {
        folder= albumArtRootFolder + artist + '/' + album + '/';
    }
    else
    {
        folder= albumArtRootFolder + artist + '/';
    }

	var fileName = resolution;

	fs.ensureDirSync(folder);
	var infoPath = folder + 'info.json';

	var infoJson = {};

	if (fs.existsSync(infoPath) == false) {
		fs.ensureFileSync(infoPath);
		fs.writeJsonSync(infoPath, infoJson);
	}

	var stats = fs.statSync(infoPath);
	var fileSizeInBytes = stats["size"];

    if (fileSizeInBytes > 0)
    {
        infoJson = fs.readJsonSync(infoPath, {throws: false});
    }


    if (infoJson[resolution] == undefined) {
        var decodedArtist=nodetools.urlDecode(artist);
        var decodedAlbum=nodetools.urlDecode(album);
        var decodedResolution=nodetools.urlDecode(resolution);

        if(decodedAlbum===''){
			decodedAlbum = decodedAlbum|| null;
		}

		albumart(decodedArtist, decodedAlbum, decodedResolution, function (err, url) {
            if (err) {
                console.log("ERROR getting albumart: " + err + " for Infopath '" + infoPath + "'");
                defer.reject(new Error(err));
                return defer.promise;
            }
            else {
                if (url != undefined && url != '') {
                    var splitted = url.split('.');
                    var fileExtension = splitted[splitted.length - 1];
                    var diskFileName = uuid.v4() + '.' + fileExtension;

                    var options = {
                        directory: folder,
                        filename: diskFileName
                    };

					//console.log("URL: " + url);
                    download(url, options, function (err) {
                        if (err) defer.reject(new Error(err));
                        else {
                            //waiting 2 secodns to flush data on disk. Should use a better method
                            setTimeout(function(){
                                defer.resolve(folder + diskFileName);
                            },500);
                        }
                    });

                    infoJson[resolution] = diskFileName;

                }

                else {
                    defer.reject(new Error('No albumart URL'));
                    return defer.promise;
                }
            }
			
            fs.writeJsonSync(infoPath, infoJson);
        });
	}
	else {
		defer.resolve(folder + infoJson[resolution]);
	}
};

var searchInFolder = function (defer, path, web) {
	var coverFolder = '';
	var splitted = path.split('/');

	for (var k = 1; k < splitted.length; k++) {
		coverFolder = coverFolder + '/' + splitted[k];
	}

	if (fs.existsSync(coverFolder)) {
		//logger.info("Searching in folder " + coverFolder);
		var stats = fs.statSync(coverFolder);

		if (stats.isFile()) {
			var fileSizeInBytes = stats["size"];
			if (fileSizeInBytes > 0) {
				defer.resolve(coverFolder);
				return defer.promise;
			}
			else {
				defer.reject(new Error('Filesize is zero'));
				return defer.promise;
			}
		}

		/**
		 * Trying to read albumart from file
		 */

		var covers = ['coverart.jpg', 'albumart.jpg', 'coverart.png', 'albumart.png',
			'cover.JPG' , 'Cover.JPG' , 'folder.JPG','Folder.JPG',
			'cover.PNG' , 'Cover.PNG' , 'folder.PNG','Folder.PNG',
			'cover.jpg', 'Cover.jpg', 'folder.jpg', 'Folder.jpg',
			'cover.png', 'Cover.png', 'folder.png', 'Folder.png'];
		splitted = path.split('/');


		for (var i in covers) {
			var coverFile = coverFolder + '/' + covers[i];
			//console.log("Searching for cover " + coverFile);
			if (fs.existsSync(coverFile)) {
                var cacheFile=mountAlbumartFolder+'/'+coverFolder+'/extralarge.jpeg';
                //logger.info('Copying file to cache ['+cacheFile+']');
                fs.ensureFileSync(cacheFile);
                fs.copySync(coverFile,cacheFile);
				defer.resolve(cacheFile);
				return defer.promise;
			}
		}


	} else {
		//logger.info('Folder ' + coverFolder + ' does not exist');
	}
	searchOnline(defer, web);

};

var searchImageMetadata = function (defer, path, web, metadataimage) {

	if (!metadataimage) {
		searchInFolder(defer, path, web)
	} else {
		//console.log(path)
        if (fs.existsSync(path)) {
            //logger.info("Searching in folder " + coverFolder);
            var stats = fs.statSync(path);

            var files = fs.readdirSync(path);
            for (var j = 0; j < 1; j++) {
                var fileName = S(files[j]);
                var file = path + '/' + fileName.s;
                var statsFile = fs.statSync(file);

                //console.log(path+'/'+fileName.s);

                if (!statsFile.isDirectory()) {
                    //console.log(statsFile)
                    var parser = mm(fs.createReadStream(file), function (err, metadata) {
                        if (err) {
                            searchInFolder(defer, path, web)
                        }
                        else if (metadata.picture != undefined && metadata.picture.length > 0) {
                            console.log('OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO')
                            logger.info("Found art in file " + path);
							 var cacheFile=metadataAlbumartFolder+'/'+path+'/metadataimage';
							 //logger.info('Copying file to cache ['+cacheFile+']');
							 fs.ensureFileSync(cacheFile);


							 fs.writeFile(cacheFile, metadata.picture[0].data, function (err) {
							 	defer.resolve(cacheFile);
							 	return defer.promise;

							 });
                        } else {
                            searchInFolder(defer, path, web)
						}
                    });
                }

            }
        } else {
            //logger.info('Folder ' + coverFolder + ' does not exist');
            searchInFolder(defer, path, web)
        }
    }


};

/**
 *    This method searches for the album art, downloads it if needed
 *    and returns its file path. The return value is a promise
 **/
var processRequest = function (web, path, metadataimage) {
	var defer = Q.defer();

	if (web == undefined && path == undefined) {
	    logger.info('No input data');
		defer.reject(new Error(''));
		return defer.promise;
	}

	if (path != undefined) {
        path=nodetools.urlDecode(path);

        path=sanitizeUri(path);

        if(path.startsWith('/')){
        	if (path.startsWith('/tmp/')){

			} else {
				path = '/mnt' + path;
			}
		} else {
			path = '/mnt/' + path;
		}

        if (fs.existsSync(path)) {
            var stats = fs.statSync(path);
            var isFolder=false;
            var imageSize='extralarge';

            /**
             * Trying to hit the disk cache
             *
             */
            var coverFolder = '';

            if (stats.isDirectory()) {
                coverFolder=path;
                isFolder=true;
            }
            else {
                var splitted = path.split('/');

                for (var k = 0; k < splitted.length - 1; k++) {
                    coverFolder = coverFolder + '/' + splitted[k];
                }
            }

            fs.ensureDirSync(coverFolder);
            var cacheFilePath=mountAlbumartFolder+coverFolder+'/'+imageSize+'.jpeg';
            //logger.info(cacheFilePath);


            if(fs.existsSync(cacheFilePath))
            {
                defer.resolve(cacheFilePath);
            }
            else {
                if (isFolder) {
                    searchImageMetadata(defer, path, web, metadataimage);
                } else {
                    var starttime=Date.now();
                    searchImageMetadata(defer, path, web, metadataimage);

                }
            }


		} else {
			//logger.info('File' + path + ' doesnt exist');
            searchImageMetadata(defer, path, web, metadataimage);
		}

	}
    else
    {
        searchOnline(defer,web);
    }
	return defer.promise;
};


/**
 *    This method processes incoming request from express.
 *    The following variables are needed to be in req.params
 *   artist
 *    album
 *    resolution
 *
 *    To achieve this assign this function to a path like /:artist/:album/:resolution
 **/
var processExpressRequest = function (req, res) {
    var rawQuery=req._parsedUrl.query;

	var web = req.query.web;
	var path = req.query.path;
    var icon = req.query.icon;
    var sourceicon = req.query.sourceicon;
    var metadataimage = req.query.metadataimage;

    if(rawQuery !== undefined && rawQuery !== null)
    {
        var splitted=rawQuery.split('&');
        for(var i in splitted)
        {
            var itemSplitted=splitted[i].split('=');
            if(itemSplitted[0]==='web')
                web=itemSplitted[1];
            else if(itemSplitted[0]==='path')
                path=itemSplitted[1];
            else if(itemSplitted[0]==='icon')
                icon=itemSplitted[1];
        }
    }


    //var starttime=Date.now();
	var promise = processRequest(web, path, metadataimage);
	promise.then(function (filePath) {
			//logger.info('Sending file ' + filePath);

            //var stoptime=Date.now();
            //logger.info('Serving request took '+(stoptime-starttime)+' milliseconds');
		    res.setHeader('Cache-Control', 'public, max-age=2628000')
			res.sendFile(filePath);
		})
		.fail(function () {
		    if(icon!==undefined){
				res.setHeader('Cache-Control', 'public, max-age=2628000')
                res.sendFile(__dirname + '/icons/'+icon+'.jpg');
			} else if (sourceicon!==undefined) {
                try {
                	var corepluginurl = '/volumio/app/plugins/' + sourceicon;
                	var pluginurl = '/data/plugins/' + sourceicon;
                	if (fs.existsSync(corepluginurl)) {
                        res.sendFile(corepluginurl);
                	} else {
                    	res.sendFile(pluginurl);
                	}
            	}	catch(e) {
                    try{
                        res.sendFile(__dirname + '/default.jpg');
                    } catch(e) {
                        res.sendFile(__dirname + '/default.png');
                    }
				}
			} else {
			    res.setHeader('Cache-Control', 'public, max-age=2628000')
                try{
                    res.sendFile(__dirname + '/default.jpg');
                } catch(e) {
                    res.sendFile(__dirname + '/default.png');
                }
			}
		});
};

var sanitizeUri = function (uri) {
    return uri.replace('music-library/', '').replace('mnt/', '');
}


module.exports.processExpressRequest = processExpressRequest;
module.exports.processRequest = processRequest;
module.exports.setFolder = setFolder;
