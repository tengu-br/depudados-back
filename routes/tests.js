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
 8) preparar dados para a página de presença
*/
router.post('/dailyRun', async (req, res) => {
  req.setTimeout(1000 * 60 * 60 * 3); // 3 Horas

  var lista, presencaPageData

  // Passo (0)
  lista = testData
  // Passo (1) 316.562ms
  // lista = await getDeputadosAtuais()
  // Passo (2) 1928087.145ms
  // lista = await addPresenca(lista)
  // Passo (3) 1.394ms
  // lista = await compilePresenca(lista)
  // Passo (4) 107161.711ms
  // lista = await addInfo(lista)
  // Passo (5) 2804803.560ms
  // lista = await getGastos(lista)
  // Passo (6) 25.332ms
  // lista = await compileGastos(lista)
  // Passo (7) 102623.380ms
  // lista = await getProposicoes(lista)
  // Passo (8)
  presencaPageData = buildPresencaPageData(lista)

  res.send(presencaPageData)
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

    if (gastoTotal > 0) {
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

const buildPresencaPageData = (lista) => {
  var presencaMedia, deputadoPresencaMenor, deputadoPresencaMaior, presencaTotal, quantidadeDeputados, presencaPorPartido, listaCompleta

  // Ordenando por presenca
  lista.sort((a, b) => (a.presencaSessoes > b.presencaSessoes) ? 1 : ((b.presencaSessoes > a.presencaSessoes) ? -1 : 0))

  listaDeputadosPioresPresencas = lista.slice(0, 10)

  /*
   Essas váriaveis de deputadoPresencaMenor e deputadoPresencaMaior passam por uma verificacao adicional: ver
   se o deputado já está em exercício há mais de um mês. Isso acontece para previnir que o deputado mais
   presente seja um que só teve uma sessão e compareceu nela. Ou que o mais faltão seja o que só teve 2 sessões
   e faltou uma. Por isso é melhor não simplesmente pegar o lista[0] depois do sort para o deputado com
   a pior presenca! (ou lista[lista.length] para o melhor)
  */
  deputadoPresencaMenor = lista[0]
  deputadoPresencaMaior = lista[0]
  listaCompleta = []
  presencaMedia = 0
  presencaTotal = 0
  quantidadeDeputados = 0
  presencaPorUnidadeFederativa = {
    'AC': { nome: 'Acre', qtdDeputados: 0, somaPresenca: 0 },
    'AL': { nome: 'Alagoas', qtdDeputados: 0, somaPresenca: 0 },
    'AP': { nome: 'Amapá', qtdDeputados: 0, somaPresenca: 0 },
    'AM': { nome: 'Amazonas', qtdDeputados: 0, somaPresenca: 0 },
    'BA': { nome: 'Bahia', qtdDeputados: 0, somaPresenca: 0 },
    'CE': { nome: 'Ceará', qtdDeputados: 0, somaPresenca: 0 },
    'DF': { nome: 'Distrito Federal', qtdDeputados: 0, somaPresenca: 0 },
    'ES': { nome: 'Espírito Santo', qtdDeputados: 0, somaPresenca: 0 },
    'GO': { nome: 'Goiás', qtdDeputados: 0, somaPresenca: 0 },
    'MA': { nome: 'Maranhão', qtdDeputados: 0, somaPresenca: 0 },
    'MT': { nome: 'Mato Grosso', qtdDeputados: 0, somaPresenca: 0 },
    'MS': { nome: 'Mato Grosso do Sul', qtdDeputados: 0, somaPresenca: 0 },
    'MG': { nome: 'Minas Gerais', qtdDeputados: 0, somaPresenca: 0 },
    'PA': { nome: 'Pará', qtdDeputados: 0, somaPresenca: 0 },
    'PB': { nome: 'Paraíba', qtdDeputados: 0, somaPresenca: 0 },
    'PR': { nome: 'Paraná', qtdDeputados: 0, somaPresenca: 0 },
    'PE': { nome: 'Pernambuco', qtdDeputados: 0, somaPresenca: 0 },
    'PI': { nome: 'Piauí', qtdDeputados: 0, somaPresenca: 0 },
    'RJ': { nome: 'Rio de Janeiro', qtdDeputados: 0, somaPresenca: 0 },
    'RN': { nome: 'Rio Grande do Norte', qtdDeputados: 0, somaPresenca: 0 },
    'RS': { nome: 'Rio Grande do Sul', qtdDeputados: 0, somaPresenca: 0 },
    'RO': { nome: 'Rondônia', qtdDeputados: 0, somaPresenca: 0 },
    'RR': { nome: 'Roraima', qtdDeputados: 0, somaPresenca: 0 },
    'SC': { nome: 'Santa Catarina', qtdDeputados: 0, somaPresenca: 0 },
    'SP': { nome: 'São Paulo', qtdDeputados: 0, somaPresenca: 0 },
    'SE': { nome: 'Sergipe', qtdDeputados: 0, somaPresenca: 0 },
    'TO': { nome: 'Tocantins', qtdDeputados: 0, somaPresenca: 0 },
  }

  presencaPorPartido = {
    'MDB': { somaPresenca: 0, qtdDeputados: 0 },
    'PTB': { somaPresenca: 0, qtdDeputados: 0 },
    'PDT': { somaPresenca: 0, qtdDeputados: 0 },
    'PT': { somaPresenca: 0, qtdDeputados: 0 },
    'DEM': { somaPresenca: 0, qtdDeputados: 0 },
    'PCdoB': { somaPresenca: 0, qtdDeputados: 0 },
    'PSB': { somaPresenca: 0, qtdDeputados: 0 },
    'PSDB': { somaPresenca: 0, qtdDeputados: 0 },
    'PTC': { somaPresenca: 0, qtdDeputados: 0 },
    'PSC': { somaPresenca: 0, qtdDeputados: 0 },
    'PMN': { somaPresenca: 0, qtdDeputados: 0 },
    'CIDADANIA': { somaPresenca: 0, qtdDeputados: 0 },
    'PV': { somaPresenca: 0, qtdDeputados: 0 },
    'AVANTE': { somaPresenca: 0, qtdDeputados: 0 },
    'PP': { somaPresenca: 0, qtdDeputados: 0 },
    'PSTU': { somaPresenca: 0, qtdDeputados: 0 },
    'PCB': { somaPresenca: 0, qtdDeputados: 0 },
    'PRTB': { somaPresenca: 0, qtdDeputados: 0 },
    'DC': { somaPresenca: 0, qtdDeputados: 0 },
    'PCO': { somaPresenca: 0, qtdDeputados: 0 },
    'PODE': { somaPresenca: 0, qtdDeputados: 0 },
    'PSL': { somaPresenca: 0, qtdDeputados: 0 },
    'REPUBLICANOS': { somaPresenca: 0, qtdDeputados: 0 },
    'PSOL': { somaPresenca: 0, qtdDeputados: 0 },
    'PL': { somaPresenca: 0, qtdDeputados: 0 },
    'PSD': { somaPresenca: 0, qtdDeputados: 0 },
    'PATRIOTA': { somaPresenca: 0, qtdDeputados: 0 },
    'PROS': { somaPresenca: 0, qtdDeputados: 0 },
    'SOLIDARIEDADE': { somaPresenca: 0, qtdDeputados: 0 },
    'NOVO': { somaPresenca: 0, qtdDeputados: 0 },
    'REDE': { somaPresenca: 0, qtdDeputados: 0 },
    'PMB': { somaPresenca: 0, qtdDeputados: 0 },
    'UP': { somaPresenca: 0, qtdDeputados: 0 },
  }

  lista.map(deputado => {

    if (deputadoPresencaMenor.presencaSessoes > deputado.presencaSessoes && date.subtract(new Date(), new Date(deputado.ultimoStatus)).toDays() > 31) {
      deputadoPresencaMenor = deputado
    }
    if (deputadoPresencaMaior.presencaSessoes < deputado.presencaSessoes && date.subtract(new Date(), new Date(deputado.ultimoStatus)).toDays() > 31) {
      deputadoPresencaMaior = deputado
    }

    presencaPorUnidadeFederativa[deputado.siglaUf] = {
      ...presencaPorUnidadeFederativa[deputado.siglaUf],
      somaPresenca: presencaPorUnidadeFederativa[deputado.siglaUf].somaPresenca + deputado.presencaSessoes,
      qtdDeputados: presencaPorUnidadeFederativa[deputado.siglaUf].qtdDeputados + 1
    }

    presencaPorPartido[deputado.siglaPartido] = {
      somaPresenca: presencaPorPartido[deputado.siglaPartido].somaPresenca + deputado.presencaSessoes,
      qtdDeputados: presencaPorPartido[deputado.siglaPartido].qtdDeputados + 1
    }

    listaCompleta.push({
      nome: deputado.nomeEleitoral,
      partido: deputado.siglaPartido,
      uf: deputado.siglaUf,
      presencaSessoes: deputado.presencaSessoes
    })

    presencaTotal += deputado.presencaSessoes
    quantidadeDeputados++
  });

  presencaMedia = presencaTotal / quantidadeDeputados

  return ({
    listaCompleta,
    presencaPorPartido,
    presencaPorUnidadeFederativa,
    deputadoPresencaMenor,
    deputadoPresencaMaior,
    presencaMedia,
    listaDeputadosPioresPresencas,
  })
}

module.exports = router

