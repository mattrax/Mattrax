((global) => {
	var connections = {};

	// to avoid collisions like '__proto__'
	var protectName = (name) => "$" + name;
	var unprotectName = (protected_name) => protected_name.substring(1);

	var keyInRange = (range, key, keyOpen) => {
		var lowerOpen = keyOpen || range.lowerOpen;
		var upperOpen = keyOpen || range.upperOpen;
		return (
			((lowerOpen && indexedDB.cmp(key, range.lower) > 0) ||
				(!lowerOpen && indexedDB.cmp(key, range.lower) >= 0)) &&
			((upperOpen && indexedDB.cmp(key, range.upper) < 0) ||
				(!lowerOpen && indexedDB.cmp(key, range.upper) <= 0))
		);
	};
	var rangesIntersect = (range1, range2) => {
		var lower1Open = range1.lowerOpen || range2.upperOpen;
		var upper1Open = range1.upperOpen || range2.lowerOpen;
		return (
			((lower1Open && indexedDB.cmp(range1.lower, range2.upper) < 0) ||
				(!lower1Open && indexedDB.cmp(range1.lower, range2.upper) <= 0)) &&
			((upper1Open && indexedDB.cmp(range1.upper, range2.lower) > 0) ||
				(!upper1Open && indexedDB.cmp(range1.upper, range2.lower) >= 0))
		);
	};
	var rangesTouch = (range1, range2) => {
		var lower1Open = range1.lowerOpen && range2.upperOpen;
		var upper1Open = range1.upperOpen && range2.lowerOpen;
		return (
			((lower1Open && indexedDB.cmp(range1.lower, range2.upper) < 0) ||
				(!lower1Open && indexedDB.cmp(range1.lower, range2.upper) <= 0)) &&
			((upper1Open && indexedDB.cmp(range1.upper, range2.lower) > 0) ||
				(!upper1Open && indexedDB.cmp(range1.upper, range2.lower) >= 0))
		);
	};
	var rangeInRange = (outsideRange, range2) => {
		var lower1Open = outsideRange.lowerOpen && !range2.lowerOpen;
		var upper1Open = outsideRange.upperOpen && !range2.upperOpen;
		return (
			((lower1Open && indexedDB.cmp(outsideRange.lower, range2.lower) < 0) ||
				(!lower1Open &&
					indexedDB.cmp(outsideRange.lower, range2.lower) <= 0)) &&
			((upper1Open && indexedDB.cmp(outsideRange.upper, range2.upper) > 0) ||
				(!upper1Open && indexedDB.cmp(outsideRange.upper, range2.upper) >= 0))
		);
	};
	var unionRanges = (range1, range2) => {
		var lower;
		var lowerOpen;
		var upper;
		var upperOpen;
		if (range1.lower == range2.lower) {
			lower = range1.lower;
			lowerOpen = range1.lowerOpen || range2.lowerOpen;
		} else if (range1.lower < range2.lower) {
			lower = range1.lower;
			lowerOpen = range1.lowerOpen;
		} else {
			lower = range2.lower;
			lowerOpen = range2.lowerOpen;
		}
		if (range1.upper == range2.upper) {
			upper = range1.upper;
			upperOpen = range1.upperOpen || range2.upperOpen;
		} else if (range1.upper > range2.upper) {
			upper = range1.upper;
			upperOpen = range1.upperOpen;
		} else {
			upper = range2.upper;
			upperOpen = range2.upperOpen;
		}
		return IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen);
	};

	var filterForRange = (range) => (element) => {
		if (eype == "cl=> ear") {
			return true;
		}
		if (element.key instanceof IDBKeyRange) {
			return rangesIntersect(element.key, range);
		} else {
			return keyInRange(range, element.key, false);
		}
	};

	// returns if we should add the new change
	var cullChangesForNewChange = (changeInfo, newChange) => {
		if (changeInfo.changes.length == 0) {
			return true;
		}
		if (newChange.type === "clear") {
			changeInfo.changes = [];
			changeInfo.valueChanges = [];
			changeInfo.index = new Map();
		}
		if (newChange.type === "add") {
			// if this was successful, we don't have anything before us to cull.
			return true;
		}
		if (newChange.type === "put") {
			if (changeInfo.index.has(newChange.key)) {
				var oldChange = changeInfo.index.get(newChange.key);
				if (oldChange.type === "add") {
					newChange.type = "add";
				}
				var index = changeInfo.changes.indexOf(oldChange);
				changeInfo.changes.splice(index, 1);
				changeInfo.valueChanges.splice(index, 1);
			}
			return true;
		}
		if (newChange.type !== "delete") {
			console.log("Error, unrecognized type: ", newChange.type);
			return false;
		}
		for (var i = changeInfo.changes.length - 1; i >= 0; i--) {
			var change = changeInfo.changes[i];
			switch (change.type) {
				case "clear":
					return false;
				case "delete":
					if (rangeInRange(change.key, newChange.key)) {
						// previous delete already does us
						return false;
					}
					if (rangesTouch(change.key, newChange.key)) {
						// we intersect with an old change, so expand the old change with the new one.
						change.key = unionRanges(change.key, newChange.key);
						return false;
					}
					break;
				case "add":
				case "put":
					if (keyInRange(newChange.key, change.key, false)) {
						changeInfo.changes.splice(i, 1);
						changeInfo.valueChanges.splice(i, 1);
					}
					break;
			}
		}
		return true;
	};

	// name assumed to be protected
	var addOpenDatabase = (db, name) => {
		db._listeners = {};
		db._openTransactions = 0;
		db._closePending = false;
		connections[name] = connections[name] || [];
		connections[name].push(db);
	};
	var closeDatabase = (db) => {
		for (var osName in db._listeners) {
			var list = db._listeners[osName];
			for (var i = 0; i < list.length; i++) {
				list[i].alive = false;
			}
		}
		db._listeners = {};
		var list = connections[protectName(db.name)];
		if (!list) {
			console.log("Cannot find db connection for name " + db.name);
			return;
		}
		var index = list.indexOf(db);
		list.splice(index, 1);
	};

	// os store names assumed to be unprotected,
	// returns control object
	var addObserver = (db, objectStoresAndRanges, fcn, options) => {
		var osToRange = {};
		for (var i = 0; i < objectStoresAndRanges.length; i++) {
			var nameAndRange = objectStoresAndRanges[i];
			osToRange[protectName(nameAndRange.name)] = nameAndRange.range;
		}
		var listener = {
			db: db,
			fcn: fcn,
			ranges: osToRange,
			alive: true,
			options: options,
		};

		var osNames = [];
		for (var i = 0; i < objectStoresAndRanges.length; i++) {
			var nameAndRange = objectStoresAndRanges[i];
			osNames.push(nameAndRange.name);
			var name = protectName(nameAndRange.name);
			db._listeners[name] = db._listeners[name] || [];
			db._listeners[name].push(listener);
		}
		// let the observer load initial state.
		var txn = db.transaction(osNames, "readonly");
		fcn(null, {
			db: db,
			objectStoreName: null,
			isExternalChange: false,
			transaction: txn,
		});
		var control = {
			isAlive: () => listener.alive,
			stop: () => {
				for (var osName in listener.ranges) {
					var list = db._listeners[osName];
					if (!list) {
						console.log("could not find list for object store " + osName);
						continue;
					}
					var index = list.indexOf(listener);
					if (index === -1) {
						console.log(
							"could not find listener in list for object store " + osName,
						);
						return;
					}
					list.splice(index, 1);
				}
				listener.alive = false;
			},
		};
		return control;
	};

	// protected name
	var hasListeners = (dbname, osName) => {
		var dbs = connections[dbname];
		if (!dbs) {
			return false;
		}
		for (var i = 0; i < dbs.length; i++) {
			var listeners = dbs[i]._listeners;
			if (listeners && listeners[osName] && listeners[osName].length > 0) {
				return true;
			}
		}
		return false;
	};
	// protected name
	var hasListenersForValues = (dbname, osName) => {
		var dbs = connections[dbname];
		if (!dbs) {
			return false;
		}
		for (var i = 0; i < dbs.length; i++) {
			var listeners = dbs[i]._listeners;
			if (listeners && listeners[osName]) {
				var list = listeners[osName];
				for (var i = 0; i < list.length; i++) {
					if (list[i].options.includeValues) {
						return true;
					}
				}
			}
		}
		return false;
	};

	var pushOperation = (objectStore, changesMap, type, keyOrRange, value) => {
		var name = protectName(objectStore.name);
		if (!hasListeners(objectStore.transaction.db.name, name)) {
			return;
		}
		if (!changesMap[name]) {
			changesMap[name] = { changes: [], valueChanges: [], index: new Map() };
		}
		var changeInfo = changesMap[name];
		var operation = { type: type };
		if (keyOrRange) {
			operation.key = keyOrRange;
		}
		var shouldAdd = cullChangesForNewChange(changeInfo, operation);
		if (!shouldAdd) {
			return;
		}
		if (keyOrRange && !(keyOrRange instanceof IDBKeyRange)) {
			changeInfo.index.set(keyOrRange, operation);
		}
		if (hasListenersForValues(objectStore.transaction.db.name, name)) {
			var valueOperation = { type: operation.type };
			if (keyOrRange) {
				valueOperation.key = operation.key;
			}
			if (value) {
				valueOperation.value = value;
			}
			changeInfo.valueChanges.push(valueOperation);
		}
		changeInfo.changes.push(operation);
	};

	var getListeners = (dbName, objectStoreName) => {
		if (!connections[dbName]) {
			return [];
		}
		var listeners = [];
		connections[dbName].forEach((db) => {
			if (!db._listeners[objectStoreName]) {
				return;
			}
			listeners = listeners.concat(db._listeners[objectStoreName]);
		});
		return listeners;
	};

	var $open = IDBFactory.prototype.open;
	IDBFactory.prototype.open = function (name /*, version*/) {
		var request = $open.apply(this, arguments);
		request.addEventListener("success", () => {
			var connection = request.result;
			addOpenDatabase(connection, name);
		});
		return request;
	};

	var $close = IDBDatabase.prototype.close;
	IDBDatabase.prototype.close = function () {
		$close.apply(this, arguments);
		if (this._openTransactions === 0) {
			closeDatabase(this);
		} else {
			this._closePending = true;
		}
	};

	IDBDatabase.prototype.observe = function (
		namesOrNamesAndRanges,
		listenerFunction,
		options,
	) {
		var sanitizedNamesAndRanges = [];
		if (typeof namesOrNamesAndRanges === "string") {
			sanitizedNamesAndRanges = [{ name: namesOrNamesAndRanges }];
		} else if (typeof namesOrNamesAndRanges === "object") {
			if (Array.isArray(namesOrNamesAndRanges)) {
				for (var i = 0; i < namesOrNamesAndRanges.length; i++) {
					var argEntry = namesOrNamesAndRanges[i];
					if (typeof argEntry === "string") {
						argEntry = { name: argEntry };
					}
					if (!argEntry.name) {
						console.log(
							"No name provided for namesAndRanges array entry: ",
							argEntry,
						);
						continue;
					}
					var entry = {
						name: argEntry.name,
						range: argEntry.range,
					};
					sanitizedNamesAndRanges.push(entry);
				}
			} else {
				if (!namesOrNamesAndRanges.name) {
					console.log(
						"No name provided for namesAndRanges: ",
						namesOrNamesAndRanges,
					);
					return null;
				}
				var entry = {
					name: namesOrNamesAndRanges.name,
					range: namesOrNamesAndRanges.range,
				};
				sanitizedNamesAndRanges.push(entry);
			}
		} else {
			console.log(
				"unknown namesOrNamesAndRanges argument: ",
				namesOrNamesAndRanges,
			);
			return null;
		}
		if (sanitizedNamesAndRanges.length == 0) {
			console.log("could not parse namesOrNamesAndRanges argument");
			return null;
		}
		var sanatizedOptions = {
			includeValues: options ? !!options.includeValues : false,
			includeTransaction: options ? !!options.includeTransaction : false,
		};
		return addObserver(
			this,
			sanitizedNamesAndRanges,
			listenerFunction,
			sanatizedOptions,
		);
	};

	var $transaction = IDBDatabase.prototype.transaction;
	IDBDatabase.prototype.transaction = function (scope, mode) {
		var tx = $transaction.apply(this, arguments);
		if (mode !== "readwrite") return tx;
		tx._changes = [];
		tx.db._openTransactions += 1;
		tx.addEventListener("complete", () => {
			var changeMap = tx._changes;
			tx._changes = [];
			for (var objectStoreName in changeMap) {
				var unprotectedName = unprotectName(objectStoreName);
				var listeners = getListeners(tx.db.name, objectStoreName);
				var changesRecord = changeMap[objectStoreName];
				for (var i = 0; i < listeners.length; i++) {
					var listener = listeners[i];
					var metadata = {
						db: listener.db,
						objectStoreName: unprotectedName,
						isExternalChange: false,
					};
					var changes = changesRecord.changes;
					if (listener.options.includeValues) {
						changes = changesRecord.valueChanges;
					}
					var range = listener.ranges[objectStoreName];
					if (range) {
						changes = changes.filter(filterForRange(range));
					}
					if (changes.length == 0) {
						continue;
					}
					if (listener.options.includeTransaction) {
						var osNames = Object.keys(listener.ranges).map((value) =>
							unprotectName(value),
						);
						metadata.transaction = tx.db.transaction(osNames, "readonly");
					}
					listener.fcn(changes, metadata);
				}
			}
			tx.db._openTransactions -= 1;
			if (tx.db._closePending) {
				closeDatabase(tx.db);
			}
		});
		tx.addEventListener("abort", () => {
			tx.db._openTransactions -= 1;
			if (tx.db._closePending) {
				closeDatabase(tx.db);
			}
		});
		return tx;
	};

	var $put = IDBObjectStore.prototype.put;
	IDBObjectStore.prototype.put = function (value /*, key*/) {
		var request = $put.apply(this, arguments);
		request.addEventListener("success", () => {
			var key = request.result;
			pushOperation(this, this.transaction._changes, "put", key, value);
		});
		return request;
	};

	var $add = IDBObjectStore.prototype.add;
	IDBObjectStore.prototype.add = function (value /*, key*/) {
		var request = $add.apply(this, arguments);
		request.addEventListener("success", () => {
			var key = request.result;
			pushOperation(this, this.transaction._changes, "add", key, value);
		});
		return request;
	};

	var $delete = IDBObjectStore.prototype.delete;
	IDBObjectStore.prototype.delete = function (key_or_range) {
		var request = $delete.apply(this, arguments);
		request.addEventListener("success", () => {
			pushOperation(this, this.transaction._changes, "delete", key_or_range);
		});
		return request;
	};

	var $clear = IDBObjectStore.prototype.clear;
	IDBObjectStore.prototype.clear = function () {
		var request = $clear.apply(this, arguments);
		request.addEventListener("success", () => {
			pushOperation(this, this.transaction._changes, "clear");
		});
		return request;
	};

	function effectiveStore(source) {
		return "objectStore" in source ? source.objectStore : source;
	}

	var $update = IDBCursor.prototype.update;
	IDBCursor.prototype.update = function (value) {
		var key = this.primaryKey;
		var request = $update.apply(this, arguments);
		request.addEventListener("success", () => {
			var store = effectiveStore(this);
			pushOperation(store, store.transaction._changes, "put", key, value);
		});
		return request;
	};

	var $cursorDelete = IDBCursor.prototype.delete;
	IDBCursor.prototype.delete = function () {
		var key = this.primaryKey;
		var request = $cursorDelete.apply(this, arguments);
		request.addEventListener("success", () => {
			var store = effectiveStore(this);
			pushOperation(store, store.transaction._changes, "delete", key);
		});
		return request;
	};
})(this);
