FROM node:20-slim

# Install dependensi sistem dasar
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Membuat file package.json minimal langsung di dalam container
RUN echo '{"name":"discord-cs-bot","version":"1.0.0","main":"index.js","scripts":{"start":"node index.js"}}' > package.json

# Docker menginstal modul Node.js secara langsung (termasuk module 'debug')
RUN npm install \
    discord.js@13.17.1 \
    axios@1.6.0 \
    dotenv@16.3.1 \
    fs-extra@11.2.0 \
    debug \
    --omit=dev

# Salin seluruh kode sumber aplikasi dari komputer lokal Anda
COPY . .

# Expose port jika bot memiliki dashboard web internal (opsional)
EXPOSE 3000

# Perintah untuk menjalankan bot Discord
CMD ["node", "index.js"]
