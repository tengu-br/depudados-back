require('dotenv').config()
const testsRouter = require('./routes/tests');
const express = require('express');
var cors = require('cors');
const app = express();

app.use(cors())
app.use(express.json())

// app.use(function(req, res, next) {
//     res.header("Access-Control-Allow-Origin", "*");
//     res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
//     next();
// });

// Rotas
app.use(testsRouter);

const port = 4000

// app.timeout(1000*60*5)
app.listen(port, () => { console.log(`Server\'s fired up and running on port ${port} !`) })