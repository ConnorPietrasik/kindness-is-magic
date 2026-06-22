# syntax=docker/dockerfile:1

FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
# npm install will be performed at container start

# Copy the rest of the source code
COPY . .

# Expose Vite dev server port
EXPOSE 3000

# Run Vite dev server (host 0.0.0.0 for Docker networking)
CMD ["sh", "-c", "npm install && npm run dev -- --host 0.0.0.0 --port 3000"]
