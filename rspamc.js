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
// (d) dest <rspamd_ip_address>
// (p) port <rspamd_tcp_port>
// (f) filescan

require("http.js", 'HTTPRequest');

function smtp_error(smtp_message)
{
	var error_file = new File(processing_error_filename);
	if (!error_file.open("w")) {
		throw format("Unable to write processing error file (%s): %d",
			processing_error_filename, error_file.error);
	}
	error_file.writeln(smtp_message);
	error_file.close();
}

function handle_result(result)
{
	if (result.error) {
		throw "error from rspamd: " + result.error;
	}

	if (result.action == "no action" || result.action == "greylist") {
		log(LOG_INFO, "message declared to be clean");
	} else if (result.action == "reject") {
		log(LOG_INFO, "rejecting SPAM with SMTP error");
		var reject_message = (result.messages || {}).smtp_message || "Rejected as spam";
		smtp_error(reject_message);
		system.spamlog("SMTP","REJECTED"
			,"Rspamd suggested reject"
			,client.host_name, client.ip_address
			,recipient_address
			,reverse_path);
	} else if (result.action == "soft reject") {
		log(LOG_INFO, "deferring mail with SMTP error");
		var reject_message = "450 " + (result.messages || {}).smtp_message || "Try again later";
		smtp_error(reject_message);
		system.spamlog("SMTP","DEFERRED"
			,"Rspamd suggested soft reject"
			,client.host_name, client.ip_address
			,recipient_address
			,reverse_path);
	} else if (result.action == "add header") {
		log(LOG_INFO, "adding SPAM flag to message");
		// Open input file
		var message_file = new File(message_text_filename);
		if (!message_file.open("rb")) {
			throw format("Unable to open message text file for reading (%s): %d",
				message_text_filename, message_file.error);
		}
		// Open output file
		var new_message_file = new File(new_message_text_filename);
		if (!new_message_file.open("w")) {
			throw format("Unable to open new message text file for writing (%s): %d",
				message_text_filename, message_file.error);
		}
		// Copy file until we find end of headers
		while ((ln = message_file.readln(2048)) != null) {
			if (ln == '') {
				// Write additional header
				new_message_file.writeln("X-Spam-Flag: Yes");
				new_message_file.writeln(ln);
				break;
			} else {
				new_message_file.writeln(ln);
			}
		}
		// Copy the rest of the message
		while ((ln = message_file.readln(2048)) != null) {
			new_message_file.writeln(ln);
		}
		new_message_file.close();
		message_file.close()
	} else {
		log(LOG_WARNING, format("unimplemented action: %s", result.action));
	}
}

function rspamd_scan(address, tcp_port, use_file_scan)
{
	// Set headers to be sent to Rspamd
	var hdrs = {
		From: reverse_path,
		Helo: hello_name,
		IP: client.ip_address,
		// To be overwritten with full recipient list
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

	// Try collect full recipient list
	var ini = new File(recipient_list_filename);
	if (ini.open("r")) {
		objs = ini.iniGetAllObjects();
		var addr_list = [];
		for (var i = 0; i < objs.length; i++) {
			addr_list.push(objs[i]["To"]);
		}
		if (addr_list.length != 0) {
			hdrs["Rcpt"] = addr_list.join(",");
		}
	} else {
		log(LOG_ERR, format("!ERROR %d opening recipients file: %s",
			ini.error, recipients_list_filename));
	}

	var http_request = new HTTPRequest(undefined, undefined, hdrs);
	var rspamd_url = "http://" + address + ":" + tcp_port + "/checkv2";
	var raw_result = undefined;

	// Perform scan by sending reference to file...
	if (use_file_scan) {
		hdrs["File"] = message_text_filename;
		raw_result = http_request.Get(rspamd_url);
	// ... Or by transmitting file contents
	} else {
		var message_file = new File(message_text_filename);
		if (!message_file.open("rb")) {
			throw format("Unable to open message text file for reading (%s): %d",
				message_text_filename, message_file.error);
		}
		raw_result = http_request.Post(rspamd_url, message_file.read(),
			undefined, undefined, "application/octet-stream");
		message_file.close();
	}

	if (http_request.response_code !== 200) {
		log(LOG_ERR, format("!ERROR bad response code from rspamd: %d",
			http_request.response_code));
	}

	var presult = JSON.parse(raw_result);

	return presult
}

function main()
{
	var address = '127.0.0.1';
	var tcp_port = 11333;
	var use_file_scan = false;

	// Process arguments:
	for(i=0; i<argc; i++) {

		// Strip any prepended slashes
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

	try {
		// Call Rspamd
		var result = rspamd_scan(address, tcp_port, use_file_scan);
		// Do something with scan results
		handle_result(result);
	} catch (e) {
		// Something went wrong, log error
		log(LOG_ERR, format("!ERROR %s", e));
	}
}

main();
