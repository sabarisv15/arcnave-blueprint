'use strict';

const createApp = require('./app');

const app = createApp();
const port = process.env.PORT || 8000;

app.listen(port, () => {
  console.log(`ARCNAVE backend listening on port ${port}`);
});
