'use strict';

const app = require('./app');

const port = process.env.PORT || 8000;

app.listen(port, () => {
  console.log(`ARCNAVE backend listening on port ${port}`);
});
