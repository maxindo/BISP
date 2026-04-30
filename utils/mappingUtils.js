/**
 * Mapping Utilities for Customer Coordinates Management
 * Provides functions for coordinate validation, analysis, and formatting
 */

class MappingUtils {
    /**
     * Validate if coordinates are valid
     * @param {number} latitude - Latitude coordinate
     * @param {number} longitude - Longitude coordinate
     * @returns {boolean} - True if valid coordinates
     */
    static isValidCoordinate(latitude, longitude) {
        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);
        
        return !isNaN(lat) && !isNaN(lng) && 
               lat >= -90 && lat <= 90 && 
               lng >= -180 && lng <= 180;
    }

    /**
     * Format coordinates for display
     * @param {number} latitude - Latitude coordinate
     * @param {number} longitude - Longitude coordinate
     * @returns {string} - Formatted coordinate string
     */
    static formatCoordinates(latitude, longitude) {
        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);
        
        const latDir = lat >= 0 ? 'N' : 'S';
        const lngDir = lng >= 0 ? 'E' : 'W';
        
        return `${Math.abs(lat).toFixed(6)}°${latDir}, ${Math.abs(lng).toFixed(6)}°${lngDir}`;
    }

    /**
     * Calculate distance between two coordinates using Haversine formula
     * @param {Object} coord1 - First coordinate {latitude, longitude}
     * @param {Object} coord2 - Second coordinate {latitude, longitude}
     * @returns {number} - Distance in meters
     */
    static calculateDistance(coord1, coord2) {
        const R = 6371000; // Earth's radius in meters
        const dLat = this.toRadians(coord2.latitude - coord1.latitude);
        const dLng = this.toRadians(coord2.longitude - coord1.longitude);
        
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRadians(coord1.latitude)) * Math.cos(this.toRadians(coord2.latitude)) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Convert degrees to radians
     * @param {number} degrees - Degrees to convert
     * @returns {number} - Radians
     */
    static toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    /**
     * Get bounding box for a set of coordinates
     * @param {Array} coordinates - Array of coordinate objects {latitude, longitude}
     * @returns {Object} - Bounding box {minLat, maxLat, minLng, maxLng}
     */
    static getBoundingBox(coordinates) {
        if (!coordinates || coordinates.length === 0) {
            return null;
        }

        const lats = coordinates.map(coord => coord.latitude);
        const lngs = coordinates.map(coord => coord.longitude);

        return {
            minLat: Math.min(...lats),
            maxLat: Math.max(...lats),
            minLng: Math.min(...lngs),
            maxLng: Math.max(...lngs)
        };
    }

    /**
     * Get center coordinate for a set of coordinates
     * @param {Array} coordinates - Array of coordinate objects {latitude, longitude}
     * @returns {Object} - Center coordinate {latitude, longitude}
     */
    static getCenterCoordinate(coordinates) {
        if (!coordinates || coordinates.length === 0) {
            return null;
        }

        const avgLat = coordinates.reduce((sum, coord) => sum + coord.latitude, 0) / coordinates.length;
        const avgLng = coordinates.reduce((sum, coord) => sum + coord.longitude, 0) / coordinates.length;

        return {
            latitude: avgLat,
            longitude: avgLng
        };
    }

    /**
     * Calculate coverage area using convex hull approximation
     * @param {Array} coordinates - Array of coordinate objects {latitude, longitude}
     * @returns {number} - Area in square kilometers
     */
    static calculateCoverageArea(coordinates) {
        if (!coordinates || coordinates.length < 3) {
            return 0;
        }

        // Simple area calculation using shoelace formula
        // This is an approximation for small areas
        let area = 0;
        const n = coordinates.length;

        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += coordinates[i].longitude * coordinates[j].latitude;
            area -= coordinates[j].longitude * coordinates[i].latitude;
        }

        area = Math.abs(area) / 2;

        // Convert to square kilometers (approximate)
        // 1 degree ≈ 111 km, so 1 square degree ≈ 12,321 square km
        return area * 12321;
    }

    /**
     * Create clusters of coordinates within specified radius
     * @param {Array} coordinates - Array of coordinate objects {latitude, longitude}
     * @param {number} radius - Radius in meters
     * @returns {Array} - Array of cluster objects {latitude, longitude, count, customers}
     */
    static createClusters(coordinates, radius = 1000) {
        if (!coordinates || coordinates.length === 0) {
            return [];
        }

        const clusters = [];
        const processed = new Set();

        for (let i = 0; i < coordinates.length; i++) {
            if (processed.has(i)) continue;

            const cluster = {
                latitude: coordinates[i].latitude,
                longitude: coordinates[i].longitude,
                count: 1,
                customers: [coordinates[i]]
            };

            processed.add(i);

            // Find nearby coordinates
            for (let j = i + 1; j < coordinates.length; j++) {
                if (processed.has(j)) continue;

                const distance = this.calculateDistance(coordinates[i], coordinates[j]);
                if (distance <= radius) {
                    cluster.customers.push(coordinates[j]);
                    cluster.count++;
                    processed.add(j);
                }
            }

            // Update cluster center
            if (cluster.count > 1) {
                cluster.latitude = cluster.customers.reduce((sum, coord) => sum + coord.latitude, 0) / cluster.count;
                cluster.longitude = cluster.customers.reduce((sum, coord) => sum + coord.longitude, 0) / cluster.count;
            }

            clusters.push(cluster);
        }

        return clusters.sort((a, b) => b.count - a.count);
    }

    /**
     * Find nearest coordinate to a given point
     * @param {Object} targetCoord - Target coordinate {latitude, longitude}
     * @param {Array} coordinates - Array of coordinate objects {latitude, longitude}
     * @returns {Object} - Nearest coordinate and distance
     */
    static findNearest(targetCoord, coordinates) {
        if (!coordinates || coordinates.length === 0) {
            return null;
        }

        let nearest = null;
        let minDistance = Infinity;

        for (const coord of coordinates) {
            const distance = this.calculateDistance(targetCoord, coord);
            if (distance < minDistance) {
                minDistance = distance;
                nearest = coord;
            }
        }

        return {
            coordinate: nearest,
            distance: minDistance
        };
    }

    /**
     * Generate heatmap data for visualization
     * @param {Array} coordinates - Array of coordinate objects {latitude, longitude}
     * @param {number} gridSize - Grid size in meters
     * @returns {Array} - Heatmap data points
     */
    static generateHeatmapData(coordinates, gridSize = 500) {
        if (!coordinates || coordinates.length === 0) {
            return [];
        }

        const boundingBox = this.getBoundingBox(coordinates);
        const grid = new Map();

        // Create grid cells
        for (const coord of coordinates) {
            const gridLat = Math.floor(coord.latitude * 1000000 / gridSize) * gridSize / 1000000;
            const gridLng = Math.floor(coord.longitude * 1000000 / gridSize) * gridSize / 1000000;
            const key = `${gridLat},${gridLng}`;

            if (!grid.has(key)) {
                grid.set(key, {
                    latitude: gridLat + gridSize / 2000000, // Center of grid cell
                    longitude: gridLng + gridSize / 2000000,
                    intensity: 0
                });
            }

            grid.get(key).intensity++;
        }

        return Array.from(grid.values());
    }
}

module.exports = MappingUtils;