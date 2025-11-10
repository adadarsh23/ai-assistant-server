# Check if server is running
curl http://localhost:5000

# Health check
curl http://localhost:5000/health

# API status
curl http://localhost:5000/api/status

# Test 404
curl http://localhost:5000/unknown