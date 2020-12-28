// rspamc.js

// Rspamd client for Synchronet
// For use as mailproc.ini script to check messages against a running/listening rspamd

// ---------------------------------------------------------------------------
// Example mailproc.ini entries:

// [Command=rspamc.js]
// [Command=rspamc.js -d 127.0.0.1 -p 11333]
// ---------------------------------------------------------------------------

// Options:
// dest <rspamd_ip_address>
// port <rspamd_tcp_port>

require("http.js", 'HTTPRequest');

function main()
{
	var address = '127.0.0.1';
	var tcp_port = 11333;

	// Process arguments:
	for(i=0; i<argc; i++) {

		// Strip any pre-pended slashes
		while(argv[i].charAt(0)=='-')
			argv[i]=argv[i].slice(1);

		// Standard rspamc options:
		if(argv[i]=='d' || argv[i]=='dest')
			address = argv[++i];
		else if(argv[i]=='p' || argv[i]=='port')
			tcp_port = Number(argv[++i]);
	}

	var hdrs = {
		File: message_text_filename,
		From: reverse_path,
		Helo: hello_name,
		IP: client.ip_address,
		Rcpt: recipient_address,
	};

	// Omit hostname if it is really missing
	if (client.host_name != "<no name>") {
		hdrs["Hostname"] = client.host_name
	}

	// Try collect full recipient list
	var ini = new File(recipient_list_filename);
	if (ini.open("r")) {
		objs = ini.iniGetAllObjects();
		// XXX: if file is poorly formed?
		var addr_list = [];
		for (var i = 0; i < objs.length; i++) {
			addr_list.push(objs[i]["To"]);
		}
		hdrs["Rcpt"] = addr_list.join(",");
	} else {
		log(LOG_ERROR, "couldn't open SMTP recipient file");
	}

	var http_request = new HTTPRequest(undefined, undefined, hdrs);
	var raw_result = http_request.Get("http://" + address + ":" + tcp_port + "/checkv2");

	if(http_request.response_code !== 200) {
		log(LOG_ERROR, "bad response code from rspamd: " + http_request.response_code);
	}

	// XXX: try catch?
	var presult = JSON.parse(raw_result);
	// XXX: check rspamd error

	if(presult.action == "reject") {
		log(LOG_INFO, "rejecting SPAM with SMTP error");
		var error_file = new File(processing_error_filename);
		if(!error_file.open("w")) {
			log(LOG_ERR,format("!ERROR %d opening processing error file: %s"
				,error_file.error, processing_error_filename));
			return;
		}
		var reject_message = (presult.messages || {}).smtp_message || "Rejected as spam";
		error_file.writeln(reject_message);
		error_file.close();
		system.spamlog("SMTP","REJECTED"
			,"Rspamd " + Object.keys(presult.symbols).join(",")
			,client.host_name, client.ip_address
			,recipient_address
			,reverse_path);
		return;
	} else if(presult.action == "soft reject") {
		log(LOG_INFO, "defering mail with SMTP error");
		// XXX: copypasta
		var error_file = new File(processing_error_filename);
		if(!error_file.open("w")) {
			log(LOG_ERR,format("!ERROR %d opening processing error file: %s"
				,error_file.error, processing_error_filename));
			return;
		}
		var reject_message = (presult.messages || {}).smtp_message || "450 Try again later";
		error_file.writeln(reject_message);
		error_file.close();
		// XXX: logging?
		return;
	}
	// XXX: add header
	// XXX: rewrite subject
	// XXX: add/remove headers
	// XXX: authenticated users; DKIM
}

main();
