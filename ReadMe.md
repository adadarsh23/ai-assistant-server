# Check if server is running
curl http://localhost:5000

# Health check
curl http://localhost:5000/health

# API status
curl http://localhost:5000/api/status

# Test 404
curl http://localhost:5000/unknown

# Optional Render metadata
# RENDER_SERVICE_ID=your_render_service_id
# RENDER_OUTBOUND_IPS=74.220.48.0/24,74.220.56.0/24
