const express = require('express');
const router = new express.Router();
const fetch = require('node-fetch');
const date = require('date-and-time');
const { parseString } = require('xml2js');
const { MongoFind, MongoAdd, MongoDelete, MongoUpdate, MongoFindOne, MongoCount } = require('../db/mongo')

router.post('/presenca', async (req, res) => {
  const dbData = await MongoFindOne('depudados', 'pageData', { tag: "presenca" })
  res.send(dbData)
})

router.post('/gastos', async (req, res) => {
  const dbData = await MongoFindOne('depudados', 'pageData', { tag: "gastos" })
  res.send(dbData)
})

router.post('/proposicoes', async (req, res) => {
  const dbData = await MongoFindOne('depudados', 'pageData', { tag: "proposicoes" })
  res.send(dbData)
})

router.post('/partidos', async (req, res) => {
  const dbData = await MongoFindOne('depudados', 'pageData', { tag: "partidos" })
  res.send(dbData)
})

router.post('/deputados', async (req, res) => {
  const dbData = await MongoFindOne('depudados', 'pageData', { tag: "deputados" })
  res.send(dbData)
})


module.exports = router

