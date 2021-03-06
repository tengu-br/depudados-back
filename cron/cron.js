var cron = require('node-cron');
const { MongoFind, MongoAdd, MongoDelete, MongoUpdate, MongoFindOne, MongoCount } = require('../db/mongo')
const date = require('date-and-time');
const fetch = require('node-fetch');
const { parseString } = require('xml2js');
const testData = require('../testData/testingData.json')
fs = require('fs');

// Roda 1:01 AM todo dia
cron.schedule('1 1 * * *', async () => {
  console.log('Entrei na cron!')

  try {
    var lista

    // Passo (0) - PARA TESTES
    // lista = testData
    // Passo (1) 316.562ms ; 272.014ms
    console.log('1')
    lista = await getDeputadosAtuais()
    // Passo (2) 1928087.145ms ; 2753788.204ms
    console.log('2')
    lista = await addPresenca(lista)
    // Passo (3) 1.394ms ; 1.162ms
    console.log('3')
    lista = await compilePresenca(lista)
    // Passo (4) 107161.711ms ; 103919.982ms
    console.log('4')
    lista = await addInfo(lista)
    // Passo (5) 2804803.560ms ; 3363125.625ms
    console.log('5')
    lista = await getGastos(lista)
    // Passo (6) 25.332ms ; 17.035ms
    console.log('6')
    lista = await compileGastos(lista)
    // Passo (7) 102623.380ms ; 149780.326ms
    console.log('7')
    lista = await getProposicoes(lista)

    fs.writeFile('testing.json', lista)

    // Passo (8)
    var presencaData = buildPresencaPageData(lista)
    await MongoDelete('depudados', 'pageData', { tag: "presenca" }).then(async () => {
      await MongoAdd('depudados', 'pageData', [{ ...presencaData }])
    })
    // Passo (9)
    var gastosData = buildGastosPageData(lista)
    await MongoDelete('depudados', 'pageData', { tag: "gastos" }).then(async () => {
      await MongoAdd('depudados', 'pageData', [{ ...gastosData }])
    })
    // Passo (10)
    var proposicoesData = buildProposicoesPageData(lista)
    await MongoDelete('depudados', 'pageData', { tag: "proposicoes" }).then(async () => {
      await MongoAdd('depudados', 'pageData', [{ ...proposicoesData }])
    })
    // Passo (11)
    var partidoData = buildPartidosPageData(presencaData.dados, gastosData.dados, proposicoesData.dados, lista)  //COM REDUNDANCIA
    await MongoDelete('depudados', 'pageData', { tag: "partidos" }).then(async () => {
      await MongoAdd('depudados', 'pageData', [{ ...partidoData }])
    })
    // Passo(12)
    var deputadoData = buildDeputadosPageData(lista)
    await MongoDelete('depudados', 'pageData', { tag: "deputados" }).then(async () => {
      await MongoAdd('depudados', 'pageData', [{ ...deputadoData }])
    })

    console.log('Atualizado!')
  } catch (error) {
    console.log(error)
  }
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
              throw Error('Erro ao buscar informa????es na API da c??mara.')
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
   For-Of pois ?? s??ncrono (for-each ?? async), ajudando a n??o consumir muita mem??ria RAM (evitando 513 requests simult??neos)
   isso deixa a aplica????o bem mais lenta (de uns 2 segundos para mais de quinze minutos (2 segundos * 513 deputados)).
   Mas j?? que vai ser um endpoint rodado apenas uma vez por dia - para atualizar os dados - esses 15 minutos de espera 
   n??o importam tanto quanto se fosse uma requisi????o feita por um usu??rio externo.
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
            if (dia.frequencianoDia[0] === 'Aus??ncia') {
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
   CODE SMELLS! Deixar isso autom??tico de alguma maneira
   Atualmente s?? vai funcionar at?? o fim da legislatura
   atual em 2023. Poss??vel atraves do seguinte endpoint:
   https://dadosabertos.camara.leg.br/api/v2/legislaturas/56
  */
  var inicioMes = 2
  var inicioAno = 2019
  const legislatura = 56

  // Limites
  var fimMes = new Date().getMonth() + 1 // +1 pois ?? indice 0
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
     Repetir mais uma vez para o m??s atual (opcional...)
     Deixar para ficar mais atualizado?
     Tirar pois ?? incompleto? (d?? a impress??o que o deputado est??
     gastando menos pois os gastos ainda n??o foram cadastrados)
     Optei por deixar sem, mas caso necess??rio, basta colocar a 
     chamada adicional aqui onde est?? esse coment??rio
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
    // Resetando as vari??veis
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
      proposicoes: parseInt(response.headers.get('x-total-count'))
    })
  }

  return novaLista
}

const buildPresencaPageData = (lista) => {
  var presencaMedia, deputadoPresencaMenor, deputadoPresencaMaior, presencaTotal, quantidadeDeputados, presencaPorPartido, listaCompleta

  // Ordenando por presenca
  lista.sort((a, b) => (a.presencaSessoes > b.presencaSessoes) ? 1 : ((b.presencaSessoes > a.presencaSessoes) ? -1 : 0))

  var listaDeputadosPioresPresencas = lista.slice(0, 10)

  /*
   Essas v??riaveis de deputadoPresencaMenor e deputadoPresencaMaior passam por uma verificacao adicional: ver
   se o deputado j?? est?? em exerc??cio h?? mais de um m??s. Isso acontece para previnir que o deputado mais
   presente seja um que s?? teve uma sess??o e compareceu nela. Ou que o mais falt??o seja o que s?? teve 2 sess??es
   e faltou uma. Por isso ?? melhor n??o simplesmente pegar o lista[0] depois do sort para o deputado com
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
    'AP': { nome: 'Amap??', qtdDeputados: 0, somaPresenca: 0 },
    'AM': { nome: 'Amazonas', qtdDeputados: 0, somaPresenca: 0 },
    'BA': { nome: 'Bahia', qtdDeputados: 0, somaPresenca: 0 },
    'CE': { nome: 'Cear??', qtdDeputados: 0, somaPresenca: 0 },
    'DF': { nome: 'Distrito Federal', qtdDeputados: 0, somaPresenca: 0 },
    'ES': { nome: 'Esp??rito Santo', qtdDeputados: 0, somaPresenca: 0 },
    'GO': { nome: 'Goi??s', qtdDeputados: 0, somaPresenca: 0 },
    'MA': { nome: 'Maranh??o', qtdDeputados: 0, somaPresenca: 0 },
    'MT': { nome: 'Mato Grosso', qtdDeputados: 0, somaPresenca: 0 },
    'MS': { nome: 'Mato Grosso do Sul', qtdDeputados: 0, somaPresenca: 0 },
    'MG': { nome: 'Minas Gerais', qtdDeputados: 0, somaPresenca: 0 },
    'PA': { nome: 'Par??', qtdDeputados: 0, somaPresenca: 0 },
    'PB': { nome: 'Para??ba', qtdDeputados: 0, somaPresenca: 0 },
    'PR': { nome: 'Paran??', qtdDeputados: 0, somaPresenca: 0 },
    'PE': { nome: 'Pernambuco', qtdDeputados: 0, somaPresenca: 0 },
    'PI': { nome: 'Piau??', qtdDeputados: 0, somaPresenca: 0 },
    'RJ': { nome: 'Rio de Janeiro', qtdDeputados: 0, somaPresenca: 0 },
    'RN': { nome: 'Rio Grande do Norte', qtdDeputados: 0, somaPresenca: 0 },
    'RS': { nome: 'Rio Grande do Sul', qtdDeputados: 0, somaPresenca: 0 },
    'RO': { nome: 'Rond??nia', qtdDeputados: 0, somaPresenca: 0 },
    'RR': { nome: 'Roraima', qtdDeputados: 0, somaPresenca: 0 },
    'SC': { nome: 'Santa Catarina', qtdDeputados: 0, somaPresenca: 0 },
    'SP': { nome: 'S??o Paulo', qtdDeputados: 0, somaPresenca: 0 },
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
  presencaData = {
    tag: 'presenca',
    dados: {
      listaCompleta,
      presencaPorPartido,
      presencaPorUnidadeFederativa,
      deputadoPresencaMenor,
      deputadoPresencaMaior,
      presencaMedia,
      listaDeputadosPioresPresencas,
    }
  }

  return (presencaData)
}

const buildGastosPageData = (lista) => {
  var gastoMedio, deputadoGastoMenor, deputadoGastoMaior, gastoMedioTotal, quantidadeDeputados, gastoPorPartido, listaCompleta

  // Ordenando por gastoMedio
  lista.sort((a, b) => (a.gastoMedio > b.gastoMedio) ? -1 : ((b.gastoMedio > a.gastoMedio) ? 1 : 0))

  const gastoMediano = lista[Math.round(lista.length / 2)].gastoMedio

  var listaDeputadosMaioresGastos = lista.slice(0, 10)

  // Ver coment??rios da fun????o buildPresencaPageData
  deputadoGastoMenor = lista[0]
  deputadoGastoMaior = lista[0]
  listaCompleta = []
  gastoMedio = 0
  gastoMedioTotal = 0
  quantidadeDeputados = 0
  gastosPorUnidadeFederativa = {
    'AC': { nome: 'Acre', qtdDeputados: 0, somaGastos: 0 },
    'AL': { nome: 'Alagoas', qtdDeputados: 0, somaGastos: 0 },
    'AP': { nome: 'Amap??', qtdDeputados: 0, somaGastos: 0 },
    'AM': { nome: 'Amazonas', qtdDeputados: 0, somaGastos: 0 },
    'BA': { nome: 'Bahia', qtdDeputados: 0, somaGastos: 0 },
    'CE': { nome: 'Cear??', qtdDeputados: 0, somaGastos: 0 },
    'DF': { nome: 'Distrito Federal', qtdDeputados: 0, somaGastos: 0 },
    'ES': { nome: 'Esp??rito Santo', qtdDeputados: 0, somaGastos: 0 },
    'GO': { nome: 'Goi??s', qtdDeputados: 0, somaGastos: 0 },
    'MA': { nome: 'Maranh??o', qtdDeputados: 0, somaGastos: 0 },
    'MT': { nome: 'Mato Grosso', qtdDeputados: 0, somaGastos: 0 },
    'MS': { nome: 'Mato Grosso do Sul', qtdDeputados: 0, somaGastos: 0 },
    'MG': { nome: 'Minas Gerais', qtdDeputados: 0, somaGastos: 0 },
    'PA': { nome: 'Par??', qtdDeputados: 0, somaGastos: 0 },
    'PB': { nome: 'Para??ba', qtdDeputados: 0, somaGastos: 0 },
    'PR': { nome: 'Paran??', qtdDeputados: 0, somaGastos: 0 },
    'PE': { nome: 'Pernambuco', qtdDeputados: 0, somaGastos: 0 },
    'PI': { nome: 'Piau??', qtdDeputados: 0, somaGastos: 0 },
    'RJ': { nome: 'Rio de Janeiro', qtdDeputados: 0, somaGastos: 0 },
    'RN': { nome: 'Rio Grande do Norte', qtdDeputados: 0, somaGastos: 0 },
    'RS': { nome: 'Rio Grande do Sul', qtdDeputados: 0, somaGastos: 0 },
    'RO': { nome: 'Rond??nia', qtdDeputados: 0, somaGastos: 0 },
    'RR': { nome: 'Roraima', qtdDeputados: 0, somaGastos: 0 },
    'SC': { nome: 'Santa Catarina', qtdDeputados: 0, somaGastos: 0 },
    'SP': { nome: 'S??o Paulo', qtdDeputados: 0, somaGastos: 0 },
    'SE': { nome: 'Sergipe', qtdDeputados: 0, somaGastos: 0 },
    'TO': { nome: 'Tocantins', qtdDeputados: 0, somaGastos: 0 },
  }

  gastosPorPartido = {
    'MDB': { somaGastos: 0, qtdDeputados: 0 },
    'PTB': { somaGastos: 0, qtdDeputados: 0 },
    'PDT': { somaGastos: 0, qtdDeputados: 0 },
    'PT': { somaGastos: 0, qtdDeputados: 0 },
    'DEM': { somaGastos: 0, qtdDeputados: 0 },
    'PCdoB': { somaGastos: 0, qtdDeputados: 0 },
    'PSB': { somaGastos: 0, qtdDeputados: 0 },
    'PSDB': { somaGastos: 0, qtdDeputados: 0 },
    'PTC': { somaGastos: 0, qtdDeputados: 0 },
    'PSC': { somaGastos: 0, qtdDeputados: 0 },
    'PMN': { somaGastos: 0, qtdDeputados: 0 },
    'CIDADANIA': { somaGastos: 0, qtdDeputados: 0 },
    'PV': { somaGastos: 0, qtdDeputados: 0 },
    'AVANTE': { somaGastos: 0, qtdDeputados: 0 },
    'PP': { somaGastos: 0, qtdDeputados: 0 },
    'PSTU': { somaGastos: 0, qtdDeputados: 0 },
    'PCB': { somaGastos: 0, qtdDeputados: 0 },
    'PRTB': { somaGastos: 0, qtdDeputados: 0 },
    'DC': { somaGastos: 0, qtdDeputados: 0 },
    'PCO': { somaGastos: 0, qtdDeputados: 0 },
    'PODE': { somaGastos: 0, qtdDeputados: 0 },
    'PSL': { somaGastos: 0, qtdDeputados: 0 },
    'REPUBLICANOS': { somaGastos: 0, qtdDeputados: 0 },
    'PSOL': { somaGastos: 0, qtdDeputados: 0 },
    'PL': { somaGastos: 0, qtdDeputados: 0 },
    'PSD': { somaGastos: 0, qtdDeputados: 0 },
    'PATRIOTA': { somaGastos: 0, qtdDeputados: 0 },
    'PROS': { somaGastos: 0, qtdDeputados: 0 },
    'SOLIDARIEDADE': { somaGastos: 0, qtdDeputados: 0 },
    'NOVO': { somaGastos: 0, qtdDeputados: 0 },
    'REDE': { somaGastos: 0, qtdDeputados: 0 },
    'PMB': { somaGastos: 0, qtdDeputados: 0 },
    'UP': { somaGastos: 0, qtdDeputados: 0 },
  }

  lista.map(deputado => {

    if (deputadoGastoMenor.gastoMedio > deputado.gastoMedio && date.subtract(new Date(), new Date(deputado.ultimoStatus)).toDays() > 31) {
      deputadoGastoMenor = deputado
    }
    if (deputadoGastoMaior.gastoMedio < deputado.gastoMedio && date.subtract(new Date(), new Date(deputado.ultimoStatus)).toDays() > 31) {
      deputadoGastoMaior = deputado
    }

    gastosPorUnidadeFederativa[deputado.siglaUf] = {
      ...gastosPorUnidadeFederativa[deputado.siglaUf],
      somaGastos: gastosPorUnidadeFederativa[deputado.siglaUf].somaGastos + deputado.gastoMedio,
      qtdDeputados: gastosPorUnidadeFederativa[deputado.siglaUf].qtdDeputados + 1
    }

    gastosPorPartido[deputado.siglaPartido] = {
      somaGastos: gastosPorPartido[deputado.siglaPartido].somaGastos + deputado.gastoMedio,
      qtdDeputados: gastosPorPartido[deputado.siglaPartido].qtdDeputados + 1
    }

    listaCompleta.push({
      nome: deputado.nomeEleitoral,
      partido: deputado.siglaPartido,
      uf: deputado.siglaUf,
      gastoMedio: deputado.gastoMedio
    })

    gastoMedioTotal += deputado.gastoMedio
    quantidadeDeputados++
  });

  gastoMedio = gastoMedioTotal / quantidadeDeputados

  gastosData = {
    tag: 'gastos',
    dados: {
      gastoMedio,
      gastoMediano,
      deputadoGastoMenor,
      deputadoGastoMaior,
      gastosPorUnidadeFederativa,
      gastoMedioTotal,
      listaDeputadosMaioresGastos,
      quantidadeDeputados,
      gastosPorPartido,
      listaCompleta
    }
  }

  return (gastosData)
}

const buildProposicoesPageData = (lista) => {
  var proposicoesMedia, deputadoProposicoesMenor, deputadoProposicoesMaior, proposicoesMediaTotal,
    quantidadeDeputados, proposicoesPorPartido, listaCompleta

  // Ordenando por n?? de proposicoes nos ultimos 30 dias
  lista.sort((a, b) => (a.proposicoes > b.proposicoes) ? -1 : ((b.proposicoes > a.proposicoes) ? 1 : 0))

  const proposicoesMediana = lista[Math.round(lista.length / 2)].proposicoes

  var listaDeputadosMaioresProposicoes = lista.slice(0, 10)

  // Ver coment??rios da fun????o buildPresencaPageData
  deputadoProposicoesMenor = lista[0]
  deputadoProposicoesMaior = lista[0]
  listaCompleta = []
  proposicoesMedia = 0
  proposicoesMediaTotal = 0
  quantidadeDeputados = 0
  proposicoesPorUnidadeFederativa = {
    'AC': { nome: 'Acre', qtdDeputados: 0, somaProposicoes: 0 },
    'AL': { nome: 'Alagoas', qtdDeputados: 0, somaProposicoes: 0 },
    'AP': { nome: 'Amap??', qtdDeputados: 0, somaProposicoes: 0 },
    'AM': { nome: 'Amazonas', qtdDeputados: 0, somaProposicoes: 0 },
    'BA': { nome: 'Bahia', qtdDeputados: 0, somaProposicoes: 0 },
    'CE': { nome: 'Cear??', qtdDeputados: 0, somaProposicoes: 0 },
    'DF': { nome: 'Distrito Federal', qtdDeputados: 0, somaProposicoes: 0 },
    'ES': { nome: 'Esp??rito Santo', qtdDeputados: 0, somaProposicoes: 0 },
    'GO': { nome: 'Goi??s', qtdDeputados: 0, somaProposicoes: 0 },
    'MA': { nome: 'Maranh??o', qtdDeputados: 0, somaProposicoes: 0 },
    'MT': { nome: 'Mato Grosso', qtdDeputados: 0, somaProposicoes: 0 },
    'MS': { nome: 'Mato Grosso do Sul', qtdDeputados: 0, somaProposicoes: 0 },
    'MG': { nome: 'Minas Gerais', qtdDeputados: 0, somaProposicoes: 0 },
    'PA': { nome: 'Par??', qtdDeputados: 0, somaProposicoes: 0 },
    'PB': { nome: 'Para??ba', qtdDeputados: 0, somaProposicoes: 0 },
    'PR': { nome: 'Paran??', qtdDeputados: 0, somaProposicoes: 0 },
    'PE': { nome: 'Pernambuco', qtdDeputados: 0, somaProposicoes: 0 },
    'PI': { nome: 'Piau??', qtdDeputados: 0, somaProposicoes: 0 },
    'RJ': { nome: 'Rio de Janeiro', qtdDeputados: 0, somaProposicoes: 0 },
    'RN': { nome: 'Rio Grande do Norte', qtdDeputados: 0, somaProposicoes: 0 },
    'RS': { nome: 'Rio Grande do Sul', qtdDeputados: 0, somaProposicoes: 0 },
    'RO': { nome: 'Rond??nia', qtdDeputados: 0, somaProposicoes: 0 },
    'RR': { nome: 'Roraima', qtdDeputados: 0, somaProposicoes: 0 },
    'SC': { nome: 'Santa Catarina', qtdDeputados: 0, somaProposicoes: 0 },
    'SP': { nome: 'S??o Paulo', qtdDeputados: 0, somaProposicoes: 0 },
    'SE': { nome: 'Sergipe', qtdDeputados: 0, somaProposicoes: 0 },
    'TO': { nome: 'Tocantins', qtdDeputados: 0, somaProposicoes: 0 },
  }

  proposicoesPorPartido = {
    'MDB': { somaProposicoes: 0, qtdDeputados: 0 },
    'PTB': { somaProposicoes: 0, qtdDeputados: 0 },
    'PDT': { somaProposicoes: 0, qtdDeputados: 0 },
    'PT': { somaProposicoes: 0, qtdDeputados: 0 },
    'DEM': { somaProposicoes: 0, qtdDeputados: 0 },
    'PCdoB': { somaProposicoes: 0, qtdDeputados: 0 },
    'PSB': { somaProposicoes: 0, qtdDeputados: 0 },
    'PSDB': { somaProposicoes: 0, qtdDeputados: 0 },
    'PTC': { somaProposicoes: 0, qtdDeputados: 0 },
    'PSC': { somaProposicoes: 0, qtdDeputados: 0 },
    'PMN': { somaProposicoes: 0, qtdDeputados: 0 },
    'CIDADANIA': { somaProposicoes: 0, qtdDeputados: 0 },
    'PV': { somaProposicoes: 0, qtdDeputados: 0 },
    'AVANTE': { somaProposicoes: 0, qtdDeputados: 0 },
    'PP': { somaProposicoes: 0, qtdDeputados: 0 },
    'PSTU': { somaProposicoes: 0, qtdDeputados: 0 },
    'PCB': { somaProposicoes: 0, qtdDeputados: 0 },
    'PRTB': { somaProposicoes: 0, qtdDeputados: 0 },
    'DC': { somaProposicoes: 0, qtdDeputados: 0 },
    'PCO': { somaProposicoes: 0, qtdDeputados: 0 },
    'PODE': { somaProposicoes: 0, qtdDeputados: 0 },
    'PSL': { somaProposicoes: 0, qtdDeputados: 0 },
    'REPUBLICANOS': { somaProposicoes: 0, qtdDeputados: 0 },
    'PSOL': { somaProposicoes: 0, qtdDeputados: 0 },
    'PL': { somaProposicoes: 0, qtdDeputados: 0 },
    'PSD': { somaProposicoes: 0, qtdDeputados: 0 },
    'PATRIOTA': { somaProposicoes: 0, qtdDeputados: 0 },
    'PROS': { somaProposicoes: 0, qtdDeputados: 0 },
    'SOLIDARIEDADE': { somaProposicoes: 0, qtdDeputados: 0 },
    'NOVO': { somaProposicoes: 0, qtdDeputados: 0 },
    'REDE': { somaProposicoes: 0, qtdDeputados: 0 },
    'PMB': { somaProposicoes: 0, qtdDeputados: 0 },
    'UP': { somaProposicoes: 0, qtdDeputados: 0 },
  }

  lista.map(deputado => {

    if (deputadoProposicoesMenor.proposicoes > deputado.proposicoes && date.subtract(new Date(), new Date(deputado.ultimoStatus)).toDays() > 31) {
      deputadoProposicoesMenor = deputado
    }
    if (deputadoProposicoesMaior.proposicoes < deputado.proposicoes && date.subtract(new Date(), new Date(deputado.ultimoStatus)).toDays() > 31) {
      deputadoProposicoesMaior = deputado
    }

    proposicoesPorUnidadeFederativa[deputado.siglaUf] = {
      ...proposicoesPorUnidadeFederativa[deputado.siglaUf],
      somaProposicoes: proposicoesPorUnidadeFederativa[deputado.siglaUf].somaProposicoes + deputado.proposicoes,
      qtdDeputados: proposicoesPorUnidadeFederativa[deputado.siglaUf].qtdDeputados + 1
    }

    proposicoesPorPartido[deputado.siglaPartido] = {
      somaProposicoes: proposicoesPorPartido[deputado.siglaPartido].somaProposicoes + deputado.proposicoes,
      qtdDeputados: proposicoesPorPartido[deputado.siglaPartido].qtdDeputados + 1
    }

    listaCompleta.push({
      nome: deputado.nomeEleitoral,
      partido: deputado.siglaPartido,
      uf: deputado.siglaUf,
      proposicoes: deputado.proposicoes
    })

    proposicoesMediaTotal += deputado.proposicoes
    quantidadeDeputados++
  });

  proposicoesMedia = proposicoesMediaTotal / quantidadeDeputados

  proposicoesData = {
    tag: 'proposicoes',
    dados: {
      proposicoesMedia,
      proposicoesMediana,
      deputadoProposicoesMenor,
      deputadoProposicoesMaior,
      proposicoesPorUnidadeFederativa,
      proposicoesMediaTotal,
      listaDeputadosMaioresProposicoes,
      quantidadeDeputados,
      proposicoesPorPartido,
      listaCompleta
    }
  }

  return (proposicoesData)
}

const buildPartidosPageData = (presenca, gastos, proposicoes, lista) => {
  var deputados = []
  const listaPartidos = ['MDB', 'PTB', 'PDT', 'PT', 'DEM', 'PCdoB', 'PSB', 'PSDB', 'PTC', 'PSC', 'PMN', 'CIDADANIA', 'PV', 'AVANTE', 'PP', 'PSTU', 'PCB', 'PRTB', 'DC', 'PCO', 'PODE', 'PSL', 'REPUBLICANOS', 'PSOL', 'PL', 'PSD', 'PATRIOTA', 'PROS', 'SOLIDARIEDADE', 'NOVO', 'REDE', 'PMB', 'UP',]
  var dadosPartidos = {
    'MDB': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PTB': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PDT': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PT': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'DEM': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PCdoB': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PSB': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PSDB': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PTC': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PSC': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PMN': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'CIDADANIA': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PV': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'AVANTE': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PP': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PSTU': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PCB': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PRTB': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'DC': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PCO': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PODE': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PSL': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'REPUBLICANOS': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PSOL': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PL': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PSD': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PATRIOTA': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PROS': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'SOLIDARIEDADE': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'NOVO': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'REDE': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'PMB': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
    'UP': { somaProposicoes: 0, qtdDeputados: 0, somaGastos: 0, somaPresenca: 0 },
  }

  listaPartidos.forEach(partido => {

    lista.map((d) => {
      if (d.siglaPartido === partido) {
        deputados.push({
          nome: d.nomeEleitoral,
          uf: d.siglaUf
        })
      }
    })

    dadosPartidos[partido] = {
      qtdDeputados: presenca.presencaPorPartido[partido].qtdDeputados,
      somaPresenca: presenca.presencaPorPartido[partido].somaPresenca,
      somaProposicoes: proposicoes.proposicoesPorPartido[partido].somaProposicoes,
      somaGastos: gastos.gastosPorPartido[partido].somaGastos,
      deputados: deputados,
    }
    deputados = []
  });

  partidosData = {
    tag: 'partidos',
    dados: { listaPartidos, dadosPartidos }
  }

  return (partidosData)
}

const buildDeputadosPageData = (lista) => {
  var deputados = []
  var listaDeputados = []
  lista.map(deputado => {
    listaDeputados.push(deputado.nomeEleitoral)
    deputados.push({
      urlFoto: deputado.urlFoto,
      nome: deputado.nomeEleitoral,
      uf: deputado.siglaUf,
      partido: deputado.siglaPartido,
      gastoMedio: deputado.gastoMedio,
      proposicoes: deputado.proposicoes,
      presenca: deputado.presencaSessoes
    })
  })

  deputadosData = {
    tag: 'deputados',
    dados: { listaDeputados, deputados }
  }

  return (deputadosData)
}