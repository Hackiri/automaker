#!/bin/bash

# Automaker - Development Environment Setup and Launch Script

set -e  # Exit on error

echo "╔═══════════════════════════════════════════════════════╗"
echo "║        Automaker Development Environment              ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}Installing dependencies...${NC}"
    npm install
fi

# Install Playwright browsers if needed
echo -e "${YELLOW}Checking Playwright browsers...${NC}"
npx playwright install chromium 2>/dev/null || true

# Function to kill process on a port and wait for it to be freed
kill_port() {
    local port=$1
    local pids=$(lsof -ti:$port 2>/dev/null)
    
    if [ -n "$pids" ]; then
        echo -e "${YELLOW}Killing process(es) on port $port: $pids${NC}"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        
        # Wait for port to be freed (max 5 seconds)
        local retries=0
        while [ $retries -lt 10 ]; do
            if ! lsof -ti:$port >/dev/null 2>&1; then
                echo -e "${GREEN}✓ Port $port is now free${NC}"
                return 0
            fi
            sleep 0.5
            retries=$((retries + 1))
        done
        
        echo -e "${RED}Warning: Port $port may still be in use${NC}"
        return 1
    else
        echo -e "${GREEN}✓ Port $port is available${NC}"
        return 0
    fi
}

# Kill any existing processes on required ports
echo -e "${YELLOW}Checking for processes on ports 3007 and 3008...${NC}"
kill_port 3007
kill_port 3008
echo ""

# Prompt user for application mode
echo "═══════════════════════════════════════════════════════"
echo "  Select Application Mode:"
echo "═══════════════════════════════════════════════════════"
echo "  1) Web Application (Browser)"
echo "  2) Desktop Application (Electron)"
echo "═══════════════════════════════════════════════════════"
echo ""

SERVER_PID=""

# Cleanup function
cleanup() {
    echo 'Cleaning up...'
    if [ -n "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null || true
    fi
    exit
}

trap cleanup INT TERM EXIT

while true; do
    read -p "Enter your choice (1 or 2): " choice
    case $choice in
        1)
            echo ""
            echo -e "${BLUE}Launching Web Application...${NC}"
            
            # Start the backend server (only needed for Web mode)
            echo -e "${BLUE}Starting backend server on port 3008...${NC}"
            mkdir -p logs
            npm run dev:server > logs/server.log 2>&1 &
            SERVER_PID=$!

            echo -e "${YELLOW}Waiting for server to be ready...${NC}"

            # Wait for server health check
            MAX_RETRIES=30
            RETRY_COUNT=0
            SERVER_READY=false

            while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
                if curl -s http://localhost:3008/api/health > /dev/null 2>&1; then
                    SERVER_READY=true
                    break
                fi
                sleep 1
                RETRY_COUNT=$((RETRY_COUNT + 1))
                echo -n "."
            done

            echo ""

            if [ "$SERVER_READY" = false ]; then
                echo -e "${RED}Error: Server failed to start${NC}"
                echo "Check logs/server.log for details"
                kill $SERVER_PID 2>/dev/null || true
                exit 1
            fi

            echo -e "${GREEN}✓ Server is ready!${NC}"
            echo "The application will be available at: ${GREEN}http://localhost:3007${NC}"
            echo ""
            npm run dev:web
            break
            ;;
        2)
            echo ""
            echo -e "${BLUE}Launching Desktop Application...${NC}"
            echo -e "${YELLOW}(Electron will start its own backend server)${NC}"
            echo ""
            npm run dev:electron
            break
            ;;
        *)
            echo -e "${RED}Invalid choice. Please enter 1 or 2.${NC}"
            ;;
    esac
done
