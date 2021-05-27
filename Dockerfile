FROM node:16
    
COPY ./cron /src/cron
COPY ./db /src/db
COPY ./routes /src/routes
COPY ./testData /src/testData
COPY .env /src
COPY server.js /src
COPY package.json /src
ENV TZ=America/Sao_Paulo


#colocar em variavel de ambiente
EXPOSE 4000
WORKDIR /src
RUN npm install
CMD [ "node","server.js" ]