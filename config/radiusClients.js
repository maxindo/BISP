// Functions untuk manage FreeRADIUS clients.conf
const fs = require('fs');
const { execSync } = require('child_process');
const logger = require('./logger');

const CLIENTS_CONF_PATH = '/etc/freeradius/3.0/clients.conf';

/**
 * Parse clients.conf file dan return array of clients
 */
function parseClientsConf() {
    try {
        if (!fs.existsSync(CLIENTS_CONF_PATH)) {
            logger.warn(`clients.conf not found at ${CLIENTS_CONF_PATH}`);
            return [];
        }

        // Try to read file directly first
        let content;
        try {
            content = fs.readFileSync(CLIENTS_CONF_PATH, 'utf8');
        } catch (readError) {
            // If direct read fails, try with sudo
            try {
                content = execSync(`sudo cat ${CLIENTS_CONF_PATH}`, { encoding: 'utf8' });
            } catch (sudoError) {
                logger.error(`Cannot read clients.conf: ${readError.message}`);
                throw new Error(`Tidak dapat membaca file clients.conf: ${readError.message}`);
            }
        }
        
        const clients = [];
        let currentClient = null;
        let inClientBlock = false;
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Skip comments and empty lines
            if (line.startsWith('#') || line === '') {
                continue;
            }

            // Detect client block start: "client name {" or "client ipaddr {"
            const clientMatch = line.match(/^client\s+([^\s{]+)\s*\{/);
            if (clientMatch) {
                if (currentClient) {
                    clients.push(currentClient);
                }
                currentClient = {
                    name: clientMatch[1],
                    ipaddr: null,
                    secret: null,
                    nas_type: 'other',
                    require_message_authenticator: 'no',
                    comment: null,
                    rawLines: []
                };
                inClientBlock = true;
                currentClient.rawLines.push(lines[i]);
                continue;
            }

            // Detect client block end
            if (line === '}' && inClientBlock) {
                if (currentClient) {
                    currentClient.rawLines.push(lines[i]);
                    clients.push(currentClient);
                    currentClient = null;
                    inClientBlock = false;
                }
                continue;
            }

            // Parse client attributes
            if (inClientBlock && currentClient) {
                currentClient.rawLines.push(lines[i]);
                
                // Parse ipaddr
                const ipaddrMatch = line.match(/ipaddr\s*=\s*(.+)/);
                if (ipaddrMatch) {
                    currentClient.ipaddr = ipaddrMatch[1].trim();
                }

                // Parse secret
                const secretMatch = line.match(/secret\s*=\s*(.+)/);
                if (secretMatch) {
                    currentClient.secret = secretMatch[1].trim();
                }

                // Parse nas_type
                const nasTypeMatch = line.match(/nas_type\s*=\s*(.+)/);
                if (nasTypeMatch) {
                    currentClient.nas_type = nasTypeMatch[1].trim();
                }

                // Parse require_message_authenticator
                const msgAuthMatch = line.match(/require_message_authenticator\s*=\s*(.+)/);
                if (msgAuthMatch) {
                    currentClient.require_message_authenticator = msgAuthMatch[1].trim();
                }

                // Parse comment (if exists)
                if (line.startsWith('#')) {
                    currentClient.comment = line.substring(1).trim();
                }
            }
        }

        // Add last client if exists
        if (currentClient) {
            clients.push(currentClient);
        }

        return clients;
    } catch (error) {
        logger.error(`Error parsing clients.conf: ${error.message}`);
        throw error;
    }
}

/**
 * Write clients array back to clients.conf file
 */
function writeClientsConf(clients) {
    try {
        // Backup original file
        const backupPath = `${CLIENTS_CONF_PATH}.backup.${Date.now()}`;
        let backupCreated = false;
        
        try {
            if (fs.existsSync(CLIENTS_CONF_PATH)) {
                // Try direct copy first
                try {
                    fs.copyFileSync(CLIENTS_CONF_PATH, backupPath);
                    backupCreated = true;
                } catch (copyError) {
                    // If direct copy fails, try with sudo
                    try {
                        execSync(`sudo cp ${CLIENTS_CONF_PATH} ${backupPath}`, { encoding: 'utf8' });
                        backupCreated = true;
                    } catch (sudoCopyError) {
                        logger.warn(`Cannot create backup: ${copyError.message}`);
                    }
                }
            }
        } catch (backupError) {
            logger.warn(`Backup failed: ${backupError.message}`);
        }
        
        if (backupCreated) {
            logger.info(`Backup created: ${backupPath}`);
        }

        // Read original file untuk preserve header comments
        let headerContent = '';
        if (fs.existsSync(CLIENTS_CONF_PATH)) {
            const originalContent = fs.readFileSync(CLIENTS_CONF_PATH, 'utf8');
            const headerMatch = originalContent.match(/^([\s\S]*?)(?=^client\s)/m);
            if (headerMatch) {
                headerContent = headerMatch[1];
            }
        }

        // Default header jika tidak ada
        if (!headerContent) {
            headerContent = `## clients.conf -- client configuration directives
##
##	\$Id\$

#######################################################################
#
#  Define RADIUS clients (usually a NAS, Access Point, etc.).
#
#  Clients configured via CVLMEDIA Web Interface
#  Generated: ${new Date().toISOString()}
#

`;
        }

        // Build clients section
        let clientsSection = '';
        clients.forEach(client => {
            clientsSection += `client ${client.name} {\n`;
            if (client.ipaddr) {
                clientsSection += `\tipaddr = ${client.ipaddr}\n`;
            }
            if (client.secret) {
                clientsSection += `\tsecret = ${client.secret}\n`;
            }
            if (client.nas_type) {
                clientsSection += `\tnas_type = ${client.nas_type}\n`;
            }
            if (client.require_message_authenticator) {
                clientsSection += `\trequire_message_authenticator = ${client.require_message_authenticator}\n`;
            }
            if (client.comment) {
                clientsSection += `\t# ${client.comment}\n`;
            }
            clientsSection += `}\n\n`;
        });

        // Write to file
        const fullContent = headerContent + clientsSection;
        try {
            fs.writeFileSync(CLIENTS_CONF_PATH, fullContent, 'utf8');
        } catch (writeError) {
            // If direct write fails, try with sudo
            try {
                const tempFile = `/tmp/clients.conf.${Date.now()}`;
                fs.writeFileSync(tempFile, fullContent, 'utf8');
                execSync(`sudo cp ${tempFile} ${CLIENTS_CONF_PATH}`, { encoding: 'utf8' });
                fs.unlinkSync(tempFile);
            } catch (sudoWriteError) {
                logger.error(`Cannot write clients.conf: ${writeError.message}`);
                throw new Error(`Tidak dapat menulis file clients.conf: ${writeError.message}`);
            }
        }
        
        logger.info(`clients.conf updated successfully with ${clients.length} clients`);

        return true;
    } catch (error) {
        logger.error(`Error writing clients.conf: ${error.message}`);
        throw error;
    }
}

/**
 * Restart FreeRADIUS service
 */
function restartFreeRADIUS() {
    try {
        // Try with sudo first
        try {
            execSync('sudo systemctl restart freeradius', { encoding: 'utf8', timeout: 10000 });
            logger.info('FreeRADIUS restarted successfully');
            return { success: true, message: 'FreeRADIUS berhasil direstart' };
        } catch (sudoError) {
            // If sudo fails, try without sudo (might work if running as root)
            try {
                execSync('systemctl restart freeradius', { encoding: 'utf8', timeout: 10000 });
                logger.info('FreeRADIUS restarted successfully (without sudo)');
                return { success: true, message: 'FreeRADIUS berhasil direstart' };
            } catch (directError) {
                logger.warn(`FreeRADIUS restart failed. Please restart manually: sudo systemctl restart freeradius`);
                return { 
                    success: false, 
                    message: 'Gagal restart FreeRADIUS secara otomatis. Silakan restart manual: sudo systemctl restart freeradius',
                    error: directError.message
                };
            }
        }
    } catch (error) {
        logger.error(`Error restarting FreeRADIUS: ${error.message}`);
        return { 
            success: false, 
            message: `Gagal restart FreeRADIUS: ${error.message}`,
            error: error.message
        };
    }
}

/**
 * Validate client data
 */
function validateClient(client) {
    const errors = [];

    if (!client.name || client.name.trim() === '') {
        errors.push('Client name diperlukan');
    }

    if (!client.ipaddr || client.ipaddr.trim() === '') {
        errors.push('IP address diperlukan');
    } else {
        // Simple IP validation
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
        if (!ipRegex.test(client.ipaddr.trim())) {
            errors.push('Format IP address tidak valid');
        }
    }

    if (!client.secret || client.secret.trim() === '') {
        errors.push('Secret diperlukan');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = {
    parseClientsConf,
    writeClientsConf,
    restartFreeRADIUS,
    validateClient,
    CLIENTS_CONF_PATH
};

