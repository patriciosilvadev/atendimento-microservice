const Atendimentos = require('../models/atendimentos');
const { prop } = require('ramda');
const multer = require('multer');
const Promise = require('bluebird');
const axios = require('axios');
const formatAtendimento = require('../utils/atendimentoSpec');
const moment = require('moment');
const { location } = require('./utils')

const populateLocation = (atendimento) => {
  return location(atendimento.endereco)
    .then(coordinates => ({
      ...atendimento,
      location: {
        coordinates,
      }
    }));
};

const getAll = async(req, res, next) => {
  const limit = parseInt(req.query.limit);
  const skip = parseInt(req.query.skip); 
  const isReqFromApp = req.query.app

  let query = { ...req.query };
  delete query.skip;
  delete query.limit;
  delete query.app;

  const result = {
    data_atendimento: 1,
    "cliente.cnpj_cpf": 1,
    "cliente.nome_razao_social": 1,
    "endereco": 1,
    "tecnico": 1,
    tipo: 1,
    _id: 1,
    estado: 1,
    createdBy: 1,
    motivos: 1,
    liberacao: 1,
    "relatorio.faturamento.equipamentos": 1,
    imagens: 1,
    location: 1,
    observacao: 1,
    descricao: 1,
    modelo_equipamento: 1,
    numero_equipamento: 1,        
  }

  for (key in query) {
    let valor = query[key];
    if (key !== "data_atendimento" && query[key] !== "null" && query[key] !== null) {
      valor = new RegExp("" + valor + "", "i");
    } else if (query[key] === "null") {
      valor = null;
    }
    query = { ...query, [key]: valor };
  }

  try {
    const count = await Atendimentos.find(query).count()
   if(isReqFromApp) {
    const atendimentos = await Atendimentos.find(query).skip(skip).limit(limit).sort( { data_atendimento: -1 } )
    return res.json({ atendimentos, count });
   }
    const atendimentos = await Atendimentos.find(query, result).skip(skip).limit(limit).sort( { data_atendimento: -1 } )
    return res.json({ atendimentos, count });
  } catch (error) {
      next(error)
  }
};

const atendimentoNew = (req, res, next) => {
  const getAtendimento = () => formatAtendimento(req.body);
  const createInstance = atendimento => new Atendimentos(atendimento);
  const saveInstance = atendimentoInstance => atendimentoInstance.save()
  const respondWithAtendimento = savedAtendimento => res.json(savedAtendimento);
  
  return Promise
    .resolve()
    .then(getAtendimento)
    .then(populateLocation)
    .then(createInstance)
    .then(saveInstance)
    .then(respondWithAtendimento)
    .catch(error => next(error));
};

const updateAtendimento = (req, res, next) => {
  const id = prop('id', req.params)
  const findAtendimentoById = id => Atendimentos.findById(id)
  const getAtendimentoFromReq = formatAtendimento(req.body)
  const updateLocation = atendimentoFromDB => {
  const atendimentoReq = formatAtendimento(req.body)

    if(
      atendimentoFromDB.endereco.cep !== atendimentoReq.endereco.cep
      || atendimentoFromDB.endereco.rua !== atendimentoReq.endereco.rua
      || !atendimentoFromDB.location
    ) {
      return populateLocation(atendimentoReq)
    }

    return atendimentoReq
  }
  const updateAtendimento = atendimento => Atendimentos
    .findByIdAndUpdate(id, atendimento, {
      runValidators: true,
      new: true,
    })
  const respondWithAtendimento = savedAtendimento => res.json(savedAtendimento);

  return Promise
    .resolve()
    .then(() => id)
    .then(findAtendimentoById)
    .then(updateLocation)
    .then(updateAtendimento)
    .then(respondWithAtendimento)
    .catch(error => next(error));
};

const getAtendimentoByID = (req, res, next) => {
  const _id = prop('id', req.params);
  Atendimentos.findById(_id)
    .then(atendimento => res.json(atendimento))
    .catch(error => next(error));
};

const patchAtendimentos = (req, res, next) => {
  const atendimentosData = prop('body', req);

  if (Array.isArray(atendimentosData)) {
    const atendimentosPromise = atendimentosData.map(atendimentoData => {
      return Atendimentos.findByIdAndUpdate(
        atendimentoData._id,
        atendimentoData,
        { new: true }
      );
    });

    Promise.all(atendimentosPromise)
      .then(atendimento => res.json(atendimento))
      .catch(error => next(error));
  } else {
    next(new Error('You have not passed an array'));
  }
};

const getTodosAtendimentosDosEmpregados = (req, res, next) => {
  const data = req.query.data || new Date();

  const login = {
    username: 'vlima',
    password: 'redhat'
  };

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };

  axios
    .request({
      headers,
      data: JSON.stringify(login),
      url: 'http://165.227.78.113:3000/login',
      method: 'POST'
    })
    .then(result => result.data.token)
    .then(token => {
      return Object.assign({}, headers, { Authorization: 'Bearer ' + token });
    })
    .then(headers => ({
      headers,
      url: 'http://165.227.78.113:3000/api/funcionarios',
      method: 'GET'
    }))
    .then(axios.request)
    .then(result => result.data)
    .then(funcionarios => {
      getAtendimentosPorData(data).then(atendimentos => {
        const funcAtendimentos = funcionarios.map(funcionario => {
          const atendimentosFunc = atendimentos.filter(
            atendimento => atendimento.tecnico._id === funcionario._id
          );
          funcionario.atendimentos = atendimentosFunc;
          return funcionario;
        });

        res.json(funcAtendimentos);
      });
    })
    .catch(error => next(error));
};

const getAtendimentosPorData = data => {
  const dataObj = new Date(data);

  return Atendimentos.find({})
    .where('data_atendimento')
    .gte(new Date(dataObj.getFullYear(), dataObj.getMonth(), dataObj.getDate()))
    .lt(
      new Date(dataObj.getFullYear(), dataObj.getMonth(), dataObj.getDate() + 1)
    );
};

const getLastAtendimentos = (req, res, next) => {

  const { cnpj_cpf, days } = req.query;
  const today = new Date();
  const lastDays = moment().subtract(parseInt(days), 'days').startOf('day');

  const findAtendimentos = cnpj_cpf => 
    Atendimentos.find({ 
      "cliente.cnpj_cpf": cnpj_cpf, 
      data_atendimento: { $gte: lastDays, $lte: today.toString() }
    })
    .sort({ data_atendimento: -1 });
    

  const sendAtendimentos = atendimentos => res.json(atendimentos)

  Promise.resolve(cnpj_cpf)
    .then(findAtendimentos)
    .then(sendAtendimentos)
    .catch(error => next(error));

}

const associarAtendimento = async (req, res, next) => {
  const _id = prop('id', req.params);
  const tecnico = prop('body', req.body);

  const atendimentoFound = await Atendimentos.findById(_id);
  const atendimentoAssociado = { ...atendimentoFound, tecnico };
  return atendimentoAssociado.save().then(atendimento => res.json(atendimento));
}

module.exports = {
  associarAtendimento,
  getAll,
  patchAtendimentos,
  atendimentoNew,
  updateAtendimento,
  getAtendimentoByID,
  getTodosAtendimentosDosEmpregados,
  getLastAtendimentos,
};
