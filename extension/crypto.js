const crypto = require('crypto');
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
/**
 * 加密函数
 * @param {string} text - 要加密的明文 (例如: "username:password")
 * @param {string} secretKey - 用户输入的秘钥
 * @returns {string} - 返回 base64 编码的密文 (格式: iv:encryptedData)
 */
function encrypt(text, secretKey) {
    const key = crypto.createHash('sha256').update(String(secretKey)).digest();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('base64') + ':' + encrypted;
}
/**
 * 解密函数
 * @param {string} encryptedText - 密文
 * @param {string} secretKey - 秘钥
 * @returns {string} - 明文
 */
function decrypt(encryptedText,secretKey){
    try{
        const key = crypto.createHash('sha256').update(String(secretKey)).digest();
        const parts = encryptedText.split(':');
        if (parts.length !== 2) throw new Error('Invalid encrypted format');
        const iv = Buffer.from(parts[0], 'base64');
        const encryptedHex = parts[1];
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }catch (_error){
        throw new Error('error');
    }
}
module.exports = { encrypt, decrypt };
