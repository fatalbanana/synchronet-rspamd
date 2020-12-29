// rspamc.js

// Rspamd client for Synchronet
// For use as mailproc.ini script to check messages against a running/listening rspamd

// ---------------------------------------------------------------------------
// Example mailproc.ini entries:

// [Rspamd]
// Command=rspamc.js --filescan
// Command=rspamc.js -d 127.0.0.1 -p 11333
// ---------------------------------------------------------------------------

// Options:
// dest <rspamd_ip_address>
// port <rspamd_tcp_port>
// filescan

require("http.js", 'HTTPRequest');

function main()
{
	var address = '127.0.0.1';
	var tcp_port = 11333;
	var use_file_scan = false;

	// Process arguments:
	for(i=0; i<argc; i++) {

		// Strip any pre-pended slashes
		while(argv[i].charAt(0)=='-')
			argv[i]=argv[i].slice(1);

		// Standard rspamc options:
		if (argv[i]=='d' || argv[i]=='dest')
			address = argv[++i];
		else if (argv[i]=='f' || argv[i]=='filescan')
			use_file_scan = true;
		else if (argv[i]=='p' || argv[i]=='port')
			tcp_port = Number(argv[++i]);
	}

	var hdrs = {
		From: reverse_path,
		Helo: hello_name,
		IP: client.ip_address,
		Rcpt: recipient_address,
	};

	// Omit hostname if it is really missing
	if (client.host_name != "<no name>") {
		hdrs["Hostname"] = client.host_name;
	}

	// Add user number if available
	if (client.user_number != 0) {
		hdrs["User"] = "" + client.user_number;
	}

	var message_body = undefined;
	if (use_file_scan) {
		// Set File header
		hdrs["File"] = message_text_filename;
	} else {
		// Or read message body...
		var message_file = new File(message_text_filename);
		if (!message_file.open("rb")) {
			log(LOG_ERROR, format("!ERROR %d opening message file: %s",
				message_file.error, message_text_filename));
			return;
		}
		message_body = message_file.read()
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
		log(LOG_ERROR, format("!ERROR %d opening recipients file: %s",
			ini.error, recipients_list_filename));
	}

	var http_request = new HTTPRequest(undefined, undefined, hdrs);
	var rspamd_url = "http://" + address + ":" + tcp_port + "/checkv2";
	var raw_result = undefined;

	if (use_file_scan) {
		raw_result = http_request.Get(rspamd_url);
	} else {
		raw_result = http_request.Post(rspamd_url, message_body,
			undefined, undefined, "application/octet-stream");
	}

	if (http_request.response_code !== 200) {
		log(LOG_ERROR, "bad response code from rspamd: " + http_request.response_code);
	}

	// XXX: try catch?
	var presult = JSON.parse(raw_result);

	if (presult.error) {
		log(LOG_ERR, "error from rspamd: " + presult.error);
		return;
	}

	if (presult.action == "reject") {
		log(LOG_INFO, "rejecting SPAM with SMTP error");
		var error_file = new File(processing_error_filename);
		if (!error_file.open("w")) {
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
	} else if (presult.action == "soft reject") {
		log(LOG_INFO, "defering mail with SMTP error");
		// XXX: copypasta
		var error_file = new File(processing_error_filename);
		if (!error_file.open("w")) {
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
	// XXX: DKIM
}

main();
