const dataHandler = require('./data').handler;
exports.handler = async (event, context) => dataHandler({ ...event, path: '/api/notifications' }, context);
