const express = require('express');
const router = new express.Router();
const fetch = require('node-fetch');
const date = require('date-and-time');
const { parseString } = require('xml2js');

const testData = require('../testData/testingData.json')

// https://dadosabertos.camara.leg.br/api/v2/deputados/204476/eventos

/*
 1) pegar a matricula e ideCadastro dos deputados em https://www.camara.leg.br/SitCamaraWS/deputados.asmx/ObterDeputados
 2) pegar a lista de presenças em https://www.camara.leg.br/SitCamaraWS/sessoesreunioes.asmx/ListarPresencasParlamentar?dataIni=20/11/2019&dataFim=23/11/2019&numMatriculaParlamentar=393
 3) fazer operações matematicas com os resultados para calcular a % da presença
 4) adicionar dados não presentes na API antiga, usando a api 2.0 da câmara
 5) adicionar array de gastos mensais durante essa legislatura
 6) adicionar total, média, maior e menor gasto do parlamentar
 7) buscar proposições com autoria de cada um dos deputados nos últimos 30 dias
 8) compilar alguns dados sobre essas proposições
*/
router.post('/testePresenca/', async (req, res) => {
  req.setTimeout(1000 * 60 * 60 * 3); // 3 Horas

  // Passo (1)
  console.log('Começando o primeiro passo...')
  console.time('1')
  var lista = await getDeputadosAtuais()
  console.log('Primeiro passo Finalizado!')
  console.timeEnd('1')
  // Passo (2)
  console.log('Começando o segundo passo...')
  console.time('2')
  lista = await addPresenca(lista)
  console.log('Segundo passo Finalizado!')
  console.timeEnd('2')
  // Passo (3)
  console.log('Começando o terceiro passo...')
  console.time('3')
  lista = await compilePresenca(lista)
  console.log('Terceiro passo Finalizado!')
  console.timeEnd('3')
  // Passo (4)
  console.log('Começando o quarto passo...')
  console.time('4')
  lista = await addInfo(lista)
  console.log('Quarto passo Finalizado!')
  console.timeEnd('4')
  // Passo (5)
  console.log('Começando o quinto passo...')
  console.time('5')
  lista = await getGastos(lista)
  console.log('Quinto passo Finalizado!')
  console.timeEnd('5')
  // Passo (6)
  console.log('Começando o sexto passo...')
  console.time('6')
  lista = await compileGastos(lista)
  console.log('Sexto passo Finalizado!')
  console.timeEnd('6')
  // Passo (7)
  console.log('Começando o sétimo passo...')
  console.time('7')
  lista = await getProposicoes(lista)
  console.log('Sétimo passo Finalizado!')
  console.timeEnd('7')

  res.send(lista)
})

const getDeputadosAtuais = async () => {
  var listaDeputadosAtuais = []
  try {
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
   For-Of pois é síncrono (for-each é async), ajudando a não consumir muita memória RAM (evitando 513 requests simultâneos)
   isso deixa a aplicação bem mais lenta (de uns 2 segundos para mais de quinze minutos (2 segundos * 513 deputados)).
   Mas já que vai ser um endpoint rodado apenas uma vez por dia - para atualizar os dados - esses 15 minutos de espera 
   não importam tanto quanto se fosse uma requisição feita por um usuário externo.
  */
  for (const deputado of lista) {
    // console.log(deputado.nome)
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
          // console.log(novaLista.length)
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

  // console.log(novaLista)
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
  // console.log(novaLista)

  return novaLista
}

const addInfo = async (lista) => {
  var novaLista = []

  for (const deputado of lista) {
    // console.log(deputado.nome)
    await fetch(`https://dadosabertos.camara.leg.br/api/v2/deputados/${deputado.ideCadastro}`)
      .then(res => res.json())
      .then(json => {
        novaLista.push(
          {
            ...deputado,
            urlFoto: json.dados.ultimoStatus.urlFoto,
            siglaUf: json.dados.ultimoStatus.siglaUf,
            siglaPartido: json.dados.ultimoStatus.siglaPartido,
            nomeEleitoral: json.dados.ultimoStatus.nomeEleitoral,
            ultimoStatus: json.dados.ultimoStatus.data
          }
        )
      })
  }

  return novaLista
}

const getGastos = async (lista) => {
  // Starting points
  /*
   CODE SMELLS! Deixar isso automático de alguma maneira
   Atualmente só vai funcionar até o fim da legislatura
   atual em 2023. Possível atraves do seguinte endpoint:
   https://dadosabertos.camara.leg.br/api/v2/legislaturas/56
  */
  var inicioMes = 2
  var inicioAno = 2019
  const legislatura = 56

  // Limites
  var fimMes = new Date().getMonth() + 1 // +1 pois é indice 0
  var fimAno = new Date().getFullYear()

  // var count = 1
  var novaLista = []
  var listaGastos = []
  var somaGastos

  for (const deputado of lista) {
    // Resetando variaveis dos loops
    somaGastos = 0
    listaGastos = []
    inicioMes = 2
    inicioAno = 2019

    // console.log(`${count} \t ${deputado.nome}`)

    while (!((inicioAno === fimAno) && (inicioMes === fimMes))) {
      // console.log(`${inicioAno} ${inicioMes}`)

      await fetch(`https://dadosabertos.camara.leg.br/api/v2/deputados/${deputado.ideCadastro}/despesas?idLegislatura=${legislatura}&ano=${inicioAno}&mes=${inicioMes}&itens=100&ordem=ASC`)
        .then(res => res.json())
        .then(json => {
          json.dados.forEach(pagamento => {
            somaGastos += pagamento.valorLiquido
          })
          listaGastos.push({
            ano: inicioAno,
            mes: inicioMes,
            valor: Math.round((somaGastos + Number.EPSILON) * 100) / 100
          })
        })
      // Loop variables
      inicioMes++
      somaGastos = 0
      if (inicioMes === 13) {
        inicioMes = 1
        inicioAno++
      }
    }

    /*
     Repetir mais uma vez para o mês atual (opcional...)
     Deixar para ficar mais atualizado?
     Tirar pois é incompleto? (dá a impressão que o deputado está
     gastando menos pois os gastos ainda não foram cadastrados)
     Optei por deixar sem, mas caso necessário, basta colocar a 
     chamada adicional aqui onde está esse comentário
    */

    novaLista.push(
      {
        ...deputado,
        gastos: listaGastos,
      }
    )

    // count++
  }

  return novaLista
}

const compileGastos = (lista) => {
  var gastoMedio, gastoMenor, gastoMaior, gastoTotal

  var novaLista = lista.map(deputado => {
    // Resetando as variáveis
    gastoMenor = deputado.gastos[0].valor
    gastoMaior = deputado.gastos[0].valor
    gastoMedio = 0
    gastoTotal = 0
    mesesComGastos = 0

    deputado.gastos.forEach(mes => {
      gastoMenor > mes.valor ? gastoMenor = mes.valor : null
      gastoMaior < mes.valor ? gastoMaior = mes.valor : null
      mes.valor !== 0 ? mesesComGastos++ : null
      gastoTotal += mes.valor
    })

    if(gastoTotal>0){
      gastoMedio = gastoTotal / mesesComGastos
    }

    return {
      ...deputado,
      gastoMedio,
      gastoMenor,
      gastoMaior,
      gastoTotal
    }
  })
  // console.log(novaLista)

  return novaLista
}

const getProposicoes = async (lista) => {
  var novaLista = []

  const fim = new Date()
  const anoFim = fim.getFullYear()
  const mesFim = (fim.getMonth() + 1) < 10 ? ('0' + (fim.getMonth() + 1)) : (fim.getMonth() + 1)
  const diaFim = fim.getDate()

  const inicio = date.addMonths(fim, -1)
  const anoInicio = inicio.getFullYear()
  const mesInicio = (inicio.getMonth() + 1) < 10 ? ('0' + (inicio.getMonth() + 1)) : (inicio.getMonth() + 1)
  const diaInicio = inicio.getDate()

  // console.log(`https://dadosabertos.camara.leg.br/api/v2/proposicoes?idDeputadoAutor=204374&dataApresentacaoInicio=${anoInicio}-${mesInicio}-${diaInicio}&dataApresentacaoFim=${anoFim}-${mesFim}-${diaFim}&itens=10`)
  // process.exit(0)

  for (const deputado of lista) {
    // console.log(deputado.nome)
    const response = await fetch(`https://dadosabertos.camara.leg.br/api/v2/proposicoes?idDeputadoAutor=${deputado.ideCadastro}&dataApresentacaoInicio=${anoInicio}-${mesInicio}-${diaInicio}&dataApresentacaoFim=${anoFim}-${mesFim}-${diaFim}&itens=10`)
    novaLista.push({
      ...deputado,
      proposicoes: response.headers.get('x-total-count')
    })
  }

  return novaLista
}

module.exports = router