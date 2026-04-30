const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('../config/logger');
const { getRadiusConfig } = require('../config/radiusConfig');
const mysql = require('mysql2/promise');

const execAsync = promisify(exec);

/**
 * Backup RADIUS Database dan Konfigurasi
 * @returns {Promise<{success: boolean, filePath: string, message: string}>}
 */
async function backupRadius() {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupDir = path.join(process.cwd(), 'backups', 'radius');
        const backupFileName = `radius-backup-${timestamp}.tar.gz`;
        const backupFilePath = path.join(backupDir, backupFileName);
        
        // Create backup directory if not exists
        await fs.mkdir(backupDir, { recursive: true });
        
        // Create temporary directory for backup files
        const tempDir = path.join(backupDir, `temp-${timestamp}`);
        await fs.mkdir(tempDir, { recursive: true });
        
        logger.info(`Starting RADIUS backup to ${backupFilePath}`);
        
        // Get RADIUS config
        const config = await getRadiusConfig();
        const dbHost = config.radius_host || 'localhost';
        const dbUser = config.radius_user || 'radius';
        const dbPassword = config.radius_password || '';
        const dbName = config.radius_database || 'radius';
        
        // 1. Backup Database
        logger.info('Backing up RADIUS database...');
        const dbBackupFile = path.join(tempDir, 'radius-database.sql');
        
        // Build mysqldump command
        let mysqldumpCmd = `mysqldump -h ${dbHost} -u ${dbUser}`;
        if (dbPassword) {
            mysqldumpCmd += ` -p${dbPassword}`;
        }
        mysqldumpCmd += ` ${dbName} > ${dbBackupFile}`;
        
        try {
            await execAsync(mysqldumpCmd);
            logger.info('Database backup completed');
        } catch (error) {
            // Try alternative: use mysql connection
            logger.warn('mysqldump failed, trying alternative method...');
            const connection = await mysql.createConnection({
                host: dbHost,
                user: dbUser,
                password: dbPassword,
                database: dbName
            });
            
            // Get all tables
            const [tables] = await connection.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = ?",
                [dbName]
            );
            
            let sqlDump = `-- RADIUS Database Backup\n`;
            sqlDump += `-- Generated: ${new Date().toISOString()}\n`;
            sqlDump += `-- Database: ${dbName}\n\n`;
            sqlDump += `SET FOREIGN_KEY_CHECKS=0;\n\n`;
            
            // Dump each table
            for (const table of tables) {
                const tableName = table.table_name;
                logger.info(`Dumping table: ${tableName}`);
                
                // Get table structure
                const [createTable] = await connection.execute(
                    `SHOW CREATE TABLE \`${tableName}\``
                );
                sqlDump += `\n-- Table structure for ${tableName}\n`;
                sqlDump += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
                sqlDump += `${createTable[0]['Create Table']};\n\n`;
                
                // Get table data
                const [rows] = await connection.execute(`SELECT * FROM \`${tableName}\``);
                if (rows.length > 0) {
                    sqlDump += `-- Data for table ${tableName}\n`;
                    sqlDump += `LOCK TABLES \`${tableName}\` WRITE;\n`;
                    
                    // Batch insert for better performance
                    if (rows.length > 0) {
                        const columns = Object.keys(rows[0]);
                        const columnList = columns.map(c => `\`${c}\``).join(', ');
                        
                        // Insert in batches of 100
                        for (let i = 0; i < rows.length; i += 100) {
                            const batch = rows.slice(i, i + 100);
                            const valuesList = batch.map(row => {
                                const values = columns.map(col => {
                                    const val = row[col];
                                    if (val === null) return 'NULL';
                                    if (typeof val === 'string') {
                                        // Escape single quotes and backslashes
                                        return `'${val.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
                                    }
                                    if (val instanceof Date) {
                                        return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
                                    }
                                    return val;
                                });
                                return `(${values.join(', ')})`;
                            });
                            sqlDump += `INSERT INTO \`${tableName}\` (${columnList}) VALUES ${valuesList.join(', ')};\n`;
                        }
                    }
                    
                    sqlDump += `UNLOCK TABLES;\n\n`;
                }
            }
            
            sqlDump += `SET FOREIGN_KEY_CHECKS=1;\n`;
            
            await fs.writeFile(dbBackupFile, sqlDump, 'utf8');
            await connection.end();
            logger.info('Database backup completed (alternative method)');
        }
        
        // 2. Backup FreeRADIUS Configuration
        logger.info('Backing up FreeRADIUS configuration...');
        const freeradiusConfigDir = '/etc/freeradius/3.0';
        const configBackupDir = path.join(tempDir, 'freeradius-config');
        
        try {
            // Check if directory exists
            await fs.access(freeradiusConfigDir);
            
            // Copy entire config directory
            await execAsync(`cp -r ${freeradiusConfigDir} ${configBackupDir}`);
            logger.info('FreeRADIUS configuration backup completed');
        } catch (error) {
            logger.warn(`FreeRADIUS config directory not found or not accessible: ${error.message}`);
        }
        
        // 3. Backup MariaDB/MySQL credentials (if exists)
        logger.info('Backing up database credentials...');
        const credentialsFile = '/root/.freeradius_credentials';
        const credentialsBackupFile = path.join(tempDir, 'freeradius-credentials');
        
        try {
            await fs.access(credentialsFile);
            await fs.copyFile(credentialsFile, credentialsBackupFile);
            logger.info('Database credentials backup completed');
        } catch (error) {
            logger.warn(`Credentials file not found: ${error.message}`);
        }
        
        // 4. Create backup info file
        const backupInfo = {
            timestamp: new Date().toISOString(),
            database: {
                host: dbHost,
                name: dbName,
                user: dbUser
            },
            version: '1.0',
            description: 'RADIUS Server Backup - Database and Configuration'
        };
        
        await fs.writeFile(
            path.join(tempDir, 'backup-info.json'),
            JSON.stringify(backupInfo, null, 2),
            'utf8'
        );
        
        // 5. Create tar.gz archive
        logger.info('Creating backup archive...');
        await execAsync(`cd ${tempDir} && tar -czf ${backupFilePath} *`);
        
        // 6. Cleanup temp directory
        await execAsync(`rm -rf ${tempDir}`);
        
        logger.info(`RADIUS backup completed: ${backupFilePath}`);
        
        return {
            success: true,
            filePath: backupFilePath,
            fileName: backupFileName,
            message: 'Backup berhasil dibuat',
            size: (await fs.stat(backupFilePath)).size
        };
        
    } catch (error) {
        logger.error('Error creating RADIUS backup:', error);
        return {
            success: false,
            filePath: null,
            message: `Gagal membuat backup: ${error.message}`
        };
    }
}

/**
 * Restore RADIUS Database dan Konfigurasi
 * @param {string} backupFilePath - Path to backup file
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function restoreRadius(backupFilePath) {
    try {
        if (!await fs.access(backupFilePath).then(() => true).catch(() => false)) {
            throw new Error('Backup file tidak ditemukan');
        }
        
        logger.info(`Starting RADIUS restore from ${backupFilePath}`);
        
        // Get RADIUS config
        const config = await getRadiusConfig();
        const dbHost = config.radius_host || 'localhost';
        const dbUser = config.radius_user || 'radius';
        const dbPassword = config.radius_password || '';
        const dbName = config.radius_database || 'radius';
        
        // Create temporary directory for extraction
        const tempDir = path.join(process.cwd(), 'backups', 'radius', `restore-temp-${Date.now()}`);
        await fs.mkdir(tempDir, { recursive: true });
        
        try {
            // 1. Extract backup file
            logger.info('Extracting backup file...');
            await execAsync(`tar -xzf ${backupFilePath} -C ${tempDir}`);
            
            // 2. Read backup info
            const backupInfoFile = path.join(tempDir, 'backup-info.json');
            let backupInfo = null;
            try {
                const infoContent = await fs.readFile(backupInfoFile, 'utf8');
                backupInfo = JSON.parse(infoContent);
                logger.info(`Restoring backup from: ${backupInfo.timestamp}`);
            } catch (error) {
                logger.warn('Backup info file not found, continuing...');
            }
            
            // 3. Restore Database
            logger.info('Restoring RADIUS database...');
            const dbBackupFile = path.join(tempDir, 'radius-database.sql');
            
            if (await fs.access(dbBackupFile).then(() => true).catch(() => false)) {
                // Create database if not exists
                const adminConnection = await mysql.createConnection({
                    host: dbHost,
                    user: dbUser,
                    password: dbPassword
                });
                
                await adminConnection.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
                await adminConnection.end();
                
                // Restore database
                let mysqlCmd = `mysql -h ${dbHost} -u ${dbUser}`;
                if (dbPassword) {
                    mysqlCmd += ` -p${dbPassword}`;
                }
                mysqlCmd += ` ${dbName} < ${dbBackupFile}`;
                
                try {
                    await execAsync(mysqlCmd);
                    logger.info('Database restore completed');
                } catch (error) {
                    // Try alternative: use mysql connection
                    logger.warn('mysql command failed, trying alternative method...');
                    const connection = await mysql.createConnection({
                        host: dbHost,
                        user: dbUser,
                        password: dbPassword,
                        database: dbName,
                        multipleStatements: true
                    });
                    
                    const sqlContent = await fs.readFile(dbBackupFile, 'utf8');
                    await connection.query(sqlContent);
                    await connection.end();
                    logger.info('Database restore completed (alternative method)');
                }
            } else {
                throw new Error('Database backup file tidak ditemukan');
            }
            
            // 4. Restore FreeRADIUS Configuration
            logger.info('Restoring FreeRADIUS configuration...');
            const configBackupDir = path.join(tempDir, 'freeradius-config');
            const freeradiusConfigDir = '/etc/freeradius/3.0';
            
            if (await fs.access(configBackupDir).then(() => true).catch(() => false)) {
                // Backup existing config first
                const existingBackup = `${freeradiusConfigDir}.backup-${Date.now()}`;
                try {
                    await execAsync(`cp -r ${freeradiusConfigDir} ${existingBackup}`);
                    logger.info(`Existing config backed up to: ${existingBackup}`);
                } catch (error) {
                    logger.warn(`Could not backup existing config: ${error.message}`);
                }
                
                // Restore config
                await execAsync(`cp -r ${configBackupDir}/* ${freeradiusConfigDir}/`);
                
                // Fix permissions
                await execAsync(`chown -R freerad:freerad ${freeradiusConfigDir}`);
                await execAsync(`find ${freeradiusConfigDir} -type f -exec chmod 640 {} \\;`);
                await execAsync(`find ${freeradiusConfigDir} -type d -exec chmod 750 {} \\;`);
                
                logger.info('FreeRADIUS configuration restore completed');
            } else {
                logger.warn('FreeRADIUS config backup not found, skipping...');
            }
            
            // 5. Restore credentials (if exists)
            const credentialsBackupFile = path.join(tempDir, 'freeradius-credentials');
            const credentialsFile = '/root/.freeradius_credentials';
            
            if (await fs.access(credentialsBackupFile).then(() => true).catch(() => false)) {
                await fs.copyFile(credentialsBackupFile, credentialsFile);
                await execAsync(`chmod 600 ${credentialsFile}`);
                logger.info('Database credentials restore completed');
            }
            
            // 6. Restart FreeRADIUS
            logger.info('Restarting FreeRADIUS...');
            try {
                await execAsync('systemctl restart freeradius');
                logger.info('FreeRADIUS restarted successfully');
            } catch (error) {
                logger.warn(`Failed to restart FreeRADIUS: ${error.message}`);
            }
            
            // 7. Cleanup
            await execAsync(`rm -rf ${tempDir}`);
            
            logger.info('RADIUS restore completed successfully');
            
            return {
                success: true,
                message: 'Restore berhasil. Database dan konfigurasi telah dipulihkan.'
            };
            
        } catch (error) {
            // Cleanup on error
            try {
                await execAsync(`rm -rf ${tempDir}`);
            } catch (cleanupError) {
                logger.error('Cleanup error:', cleanupError);
            }
            throw error;
        }
        
    } catch (error) {
        logger.error('Error restoring RADIUS backup:', error);
        return {
            success: false,
            message: `Gagal restore backup: ${error.message}`
        };
    }
}

/**
 * List all backup files
 * @returns {Promise<Array>}
 */
async function listBackups() {
    try {
        const backupDir = path.join(process.cwd(), 'backups', 'radius');
        await fs.mkdir(backupDir, { recursive: true });
        
        const files = await fs.readdir(backupDir);
        const backups = [];
        
        for (const file of files) {
            if (file.endsWith('.tar.gz') && !file.startsWith('temp-')) {
                const filePath = path.join(backupDir, file);
                const stats = await fs.stat(filePath);
                backups.push({
                    fileName: file,
                    filePath: filePath,
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime
                });
            }
        }
        
        // Sort by created date (newest first)
        backups.sort((a, b) => b.created - a.created);
        
        return backups;
    } catch (error) {
        logger.error('Error listing backups:', error);
        return [];
    }
}

module.exports = {
    backupRadius,
    restoreRadius,
    listBackups
};

