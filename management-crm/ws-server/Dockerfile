FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY index.js .
USER node
EXPOSE 3001
CMD ["node", "index.js"]
