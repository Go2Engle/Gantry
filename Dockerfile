# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Build the Go binary
FROM golang:1.25-alpine AS go-builder
WORKDIR /app
# Download dependencies first for layer caching
COPY go.mod go.sum ./
RUN go mod download
# Copy source code
COPY . .
# Copy frontend build output so the Go binary can embed it
COPY --from=frontend-builder /app/web/dist ./web/dist
# Build with CGO disabled (modernc.org/sqlite is pure Go)
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /gantry ./cmd/gantry

# Stage 3: Minimal runtime image
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=go-builder /gantry /gantry
EXPOSE 8080
ENTRYPOINT ["/gantry", "serve"]
