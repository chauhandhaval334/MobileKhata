FROM node:18-bullseye-slim

# Install postgresql-client to provide pg_dump utility for backups
RUN apt-get update && \
    apt-get install -y postgresql-client && \
    rm -rf /var/lib/apt/lists/*

# Create application directory
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy remaining source code
COPY . .

# Expose standard port
EXPOSE 3000

# Start server
CMD ["node", "src/server.js"]
