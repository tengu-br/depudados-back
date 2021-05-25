const { MongoClient } = require("mongodb");

const client = new MongoClient(process.env.MONGO_URI);
client.connect();


async function MongoFind(db, col, query, options) {
  try {
    const database = client.db(db);
    const collection = database.collection(col);
    const cursor = collection.find(query, options);
    cursor.forEach(console.dir);
  } catch (e) {
    console.log(`DB Error: ${e}`)
  }
}

async function MongoFindOne(db, col, query, options) {
  try {
    const database = client.db(db);
    const collection = database.collection(col);
    const result = collection.findOne(query, options);
    return result
  } catch (e) {
    console.log(`DB Error: ${e}`)
  }
}

async function MongoAdd(db, col, query, options) {
  try {
    const database = client.db(db);
    const collection = database.collection(col);
    const results = collection.insertMany(query, options);
    // console.log(results)
  } catch (e) {
    console.log(`DB Error: ${e}`)
  }
}

async function MongoDelete(db, col, query, options) {
  try {
    const database = client.db(db);
    const collection = database.collection(col);
    const results = collection.deleteMany(query, options);
    // console.log(results)
  } catch (e) {
    console.log(`DB Error: ${e}`)
  }
}

async function MongoUpdate(db, col, query, options) {
  try {
    const database = client.db(db);
    const collection = database.collection(col);
    const results = await collection.updateOne(query, options);
    // console.log(results)
  } catch (e) {
    console.log(`DB Error: ${e}`)
  }
}

async function MongoCount(db, col) {
  try {
    const database = client.db(db);
    const collection = database.collection(col);
    const results = await collection.countDocuments({})
    // console.log(results)
    return results
  } catch (e) {
    console.log(`DB Error: ${e}`)
  }
}

module.exports = {
  MongoAdd,
  MongoFind,
  MongoDelete,
  MongoUpdate,
  MongoFindOne,
  MongoCount
}