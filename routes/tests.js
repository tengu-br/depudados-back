const express = require('express');
const router = new express.Router();
const fetch = require('node-fetch');
const { parseString } = require('xml2js');

const testData = require('../testData/withDates.json')

// https://dadosabertos.camara.leg.br/api/v2/deputados/204476/eventos

/*
 1) pegar a matricula e ideCadastro dos deputados em https://www.camara.leg.br/SitCamaraWS/deputados.asmx/ObterDeputados
 2) pegar a lista de presenças em https://www.camara.leg.br/SitCamaraWS/sessoesreunioes.asmx/ListarPresencasParlamentar?dataIni=20/11/2019&dataFim=23/11/2019&numMatriculaParlamentar=393
 3) fazer operações matematicas com os resultados para calcular a % da presença
 4) adicionar dados não presentes na API antiga, usando a api 2.0 da câmara
*/
router.post('/testePresenca/', async (req, res) => {
  req.setTimeout(5000000);
  // Passo (1)
  // var lista = await getDeputadosAtuais()
  // Passo (2)
  // var lista = await addPresenca(lista)
  // Passo (3)
  // var lista = await compilePresenca(lista)
  // Passo (4)
  var lista = await addInfo(testData)

  // console.log(testData)
  res.send(lista)
})

const getDeputadosAtuais = async () => {
  var listaDeputadosAtuais = []
  try {
    // Passo (1)
    await fetch('https://www.camara.leg.br/SitCamaraWS/deputados.asmx/ObterDeputados')
      .then(res => res.text())
      .then(text => {
        parseString(text, async function (err, result) {
          try {
            if (err) {
              throw Error('Erro ao buscar informações na API da câmara.')
            }
            response = result
            await result.deputados.deputado.forEach(async deputado => {
              listaDeputadosAtuais.push({
                ideCadastro: deputado.ideCadastro[0],
                matricula: deputado.matricula[0],
                nome: deputado.nome[0],
              })
            });
          } catch (error) {
            console.log(error)
          }
        });
      })
      .catch(e => console.log(e))
    return listaDeputadosAtuais
  } catch (error) {
    console.log(error)
    return error
  }
}

const addPresenca = async (lista) => {
  var novaLista = []

  /*
   For-Of pois é síncrono, ajudando a não consumir muita memória RAM (evitando 513 requests simultâneos)
   isso deixa a aplicação bem mais lenta (de uns 2 segundos para mais de quinze minutos (2 segundos * 513 deputados)).
   Mas já que vai ser um endpoint rodado apenas uma vez por dia - para atualizar os dados - esses 5 minutos de espera 
   não importam tanto quanto se fosse uma requisição feita por um usuário externo.
  */
  for (const deputado of lista) {
    console.log(deputado.nome)
    await fetch(`https://www.camara.leg.br/SitCamaraWS/sessoesreunioes.asmx/ListarPresencasParlamentar?dataIni=01/02/2019&dataFim=31/01/2023&numMatriculaParlamentar=${deputado.matricula}`)
      .then(res => res.text())
      .then(text => {
        let dias = 0, sessoes = 0, faltasSessoes = 0, faltasDias = 0
        parseString(text, async function (err, result) {
          result.parlamentar.diasDeSessoes2[0].dia.map(dia => {
            dias++
            sessoes += Number(dia.qtdeSessoes[0])
            if (dia.frequencianoDia[0] === 'Ausência') {
              faltasSessoes += Number(dia.qtdeSessoes[0])
              faltasDias++
            }
          });
          console.log(novaLista.length)
          novaLista.push(
            {
              ...deputado,
              dias,
              sessoes,
              faltasSessoes,
              faltasDias,
            }
          )
        })
      })
  }

  console.log(novaLista)
  return novaLista
}

const compilePresenca = (lista) => {
  var novaLista = lista.map(deputado => {
    return {
      ...deputado,
      presencaDias: (deputado.dias - deputado.faltasDias) / deputado.dias,
      presencaSessoes: (deputado.sessoes - deputado.faltasSessoes) / deputado.sessoes,
    }
  })
  console.log(novaLista)

  return novaLista
}

const addInfo = async (lista) => {
  var novaLista = []

  /*
   For-Of pois é síncrono, ajudando a não consumir muita memória RAM (evitando 513 requests simultâneos)
   isso deixa a aplicação bem mais lenta (de uns 2 segundos para mais de quinze minutos (2 segundos * 513 deputados)).
   Mas já que vai ser um endpoint rodado apenas uma vez por dia - para atualizar os dados - esses 5 minutos de espera 
   não importam tanto quanto se fosse uma requisição feita por um usuário externo.
  */
  for (const deputado of lista) {
    console.log(deputado.nome)
    await fetch(`https://dadosabertos.camara.leg.br/api/v2/deputados/${deputado.ideCadastro}`)
      .then(res => res.json())
      .then(json => {
        novaLista.push(
          {
            ...deputado,
            urlFoto: json.dados.ultimoStatus.urlFoto,
            siglaUf: json.dados.ultimoStatus.siglaUf,
            siglaPartido: json.dados.ultimoStatus.siglaPartido,
            nomeEleitoral: json.dados.ultimoStatus.nomeEleitoral
          }
        )
      })
  }

  return novaLista
}

module.exports = router