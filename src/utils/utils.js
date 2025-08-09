const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const $root = require('../proto/message.js');

function generateCursorBody(messages, modelName) {

  const instruction = messages
    .filter(msg => msg.role === 'system')
    .map(msg => {
      // 处理system消息的content，可能是字符串或数组
      if (typeof msg.content === 'string') {
        return msg.content;
      } else if (Array.isArray(msg.content)) {
        // 如果是数组，提取所有text类型的内容
        return msg.content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');
      }
      return '';
    })
    .join('\n')

  const formattedMessages = messages
    .filter(msg => msg.role !== 'system')
    .map(msg => {
      const baseMessage = {
        role: msg.role === 'user' ? 1 : 2,
        messageId: uuidv4(),
        ...(msg.role === 'user' ? { chatModeEnum: 1 } : {})
        //...(msg.role !== 'user' ? { summaryId: uuidv4() } : {})
      };

      // 处理content，支持OpenAI格式的图片消息
      if (typeof msg.content === 'string') {
        // 简单的字符串内容
        baseMessage.content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // OpenAI格式的多模态内容
        let textContent = '';
        let imageData = null;
        let imageMetadata = null;

        for (const item of msg.content) {
          if (item.type === 'text') {
            textContent += item.text;
          } else if (item.type === 'image_url') {
            // 处理图片URL
            const imageUrl = item.image_url.url;
            if (imageUrl.startsWith('data:image/')) {
              // Base64编码的图片
              const [header, base64Data] = imageUrl.split(',');
              const mimeType = header.match(/data:image\/([^;]+)/)?.[1];
              
              if (base64Data && mimeType) {
                try {
                  // 将base64转换为buffer
                  const buffer = Buffer.from(base64Data, 'base64');
                  imageData = buffer;
                  
                  // 尝试从图片数据中获取尺寸信息（简单的JPEG/PNG检测）
                  let width = 0, height = 0;
                  if (mimeType === 'jpeg' || mimeType === 'jpg') {
                    // 简单的JPEG尺寸检测
                    const dimensions = getJPEGDimensions(buffer);
                    width = dimensions.width;
                    height = dimensions.height;
                  } else if (mimeType === 'png') {
                    // 简单的PNG尺寸检测
                    const dimensions = getPNGDimensions(buffer);
                    width = dimensions.width;
                    height = dimensions.height;
                  }
                  
                  imageMetadata = {
                    width: width || 1024,  // 默认尺寸
                    height: height || 1024
                  };
                } catch (error) {
                  console.error('处理图片数据失败:', error);
                }
              }
            }
          }
        }

        baseMessage.content = textContent;
        if (imageData && imageMetadata) {
          baseMessage.image = {
            data: imageData,
            metadata: imageMetadata
          };
        }
      } else {
        // 其他类型，转换为字符串
        baseMessage.content = String(msg.content || '');
      }

      return baseMessage;
    });

  const messageIds = formattedMessages.map(msg => {
    const { role, messageId, summaryId } = msg;
    return summaryId ? { role, messageId, summaryId } : { role, messageId };
  });

  const body = {
    request:{
      messages: formattedMessages,
      unknown2: 1,
      instruction: {
        instruction: instruction
      },
      unknown4: 1,
      model: {
        name: modelName,
        empty: '',
      },
      webTool: "",
      unknown13: 1,
      cursorSetting: {
        name: "cursor\\aisettings",
        unknown3: "",
        unknown6: {
          unknwon1: "",
          unknown2: ""
        },
        unknown8: 1,
        unknown9: 1
      },
      unknown19: 1,
      //unknown22: 1,
      conversationId: uuidv4(),
      metadata: {
        os: "win32",
        arch: "x64",
        version: "10.0.22631",
        path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        timestamp: new Date().toISOString(),
      },
      unknown27: 0,
      //unknown29: "",
      messageIds: messageIds,
      largeContext: 0,
      unknown38: 0,
      chatModeEnum: 1,
      unknown47: "",
      unknown48: 0,
      unknown49: 0,
      unknown51: 0,
      unknown53: 1,
      chatMode: "Ask"
    }
  };

  const errMsg = $root.StreamUnifiedChatWithToolsRequest.verify(body);
  if (errMsg) throw Error(errMsg);
  const instance = $root.StreamUnifiedChatWithToolsRequest.create(body);
  let buffer = $root.StreamUnifiedChatWithToolsRequest.encode(instance).finish();
  let magicNumber = 0x00
  if (formattedMessages.length >= 3){
    buffer = zlib.gzipSync(buffer)
    magicNumber = 0x01
  }

  const finalBody = Buffer.concat([
    Buffer.from([magicNumber]),
    Buffer.from(buffer.length.toString(16).padStart(8, '0'), 'hex'),
    buffer
  ])

  return finalBody
}

function chunkToUtf8String(chunk) {
  const results = []
  const thinkingResults = []
  const contentResults = []
  const errorResults = { hasError: false, errorMessage: '' }
  const buffer = Buffer.from(chunk, 'hex');
  //console.log("Chunk buffer:", buffer.toString('hex'))

  try {
    for(let i = 0; i < buffer.length; i++){
      const magicNumber = parseInt(buffer.subarray(i, i + 1).toString('hex'), 16)
      const dataLength = parseInt(buffer.subarray(i + 1, i + 5).toString('hex'), 16)
      const data = buffer.subarray(i + 5, i + 5 + dataLength)
      //console.log("Parsed buffer:", magicNumber, dataLength, data.toString('hex'))

      if (magicNumber == 0 || magicNumber == 1) {
        const gunzipData = magicNumber == 0 ? data : zlib.gunzipSync(data)
        const response = $root.StreamUnifiedChatWithToolsResponse.decode(gunzipData);
        const thinking = response?.message?.thinking?.content
        if (thinking !== undefined && thinking.length > 0){
            thinkingResults.push(thinking);
            // console.log('[DEBUG] 收到 thinking:', thinking);
        }
        const content = response?.message?.content
        if (content !== undefined && content.length > 0){
          contentResults.push(content)
          // console.log('[DEBUG] 收到 content:', content);
        }
      }
      else if (magicNumber == 2 || magicNumber == 3) { 
        // Json message
        const gunzipData = magicNumber == 2 ? data : zlib.gunzipSync(data)
        const utf8 = gunzipData.toString('utf-8')
        const message = JSON.parse(utf8)

        if (message != null && (typeof message !== 'object' || 
          (Array.isArray(message) ? message.length > 0 : Object.keys(message).length > 0))){
            //results.push(utf8)
            console.error(utf8)
            
            // 检查是否为错误消息
            if (message && message.error) {
              errorResults.hasError = true;
              errorResults.errorMessage = utf8;
            }
        }
      }
      else {
        //console.log('Unknown magic number when parsing chunk response: ' + magicNumber)
      }

      i += 5 + dataLength - 1
    }
  } catch (err) {
    console.log('Error parsing chunk response:', err)
  }

  // 如果存在错误，返回错误对象
  if (errorResults.hasError) {
    return { error: errorResults.errorMessage };
  }

  // 分别返回thinking和content内容
  return {
    reasoning_content: thinkingResults.join(''),
    content: contentResults.join('')
  };
}

function generateHashed64Hex(input, salt = '') {
  const hash = crypto.createHash('sha256');
  hash.update(input + salt);
  return hash.digest('hex');
}

function obfuscateBytes(byteArray) {
  let t = 165;
  for (let r = 0; r < byteArray.length; r++) {
    byteArray[r] = (byteArray[r] ^ t) + (r % 256);
    t = byteArray[r];
  }
  return byteArray;
}

function generateCursorChecksum(token) {
  const machineId = generateHashed64Hex(token, 'machineId');
  const macMachineId = generateHashed64Hex(token, 'macMachineId');

  const timestamp = Math.floor(Date.now() / 1e6);
  const byteArray = new Uint8Array([
    (timestamp >> 40) & 255,
    (timestamp >> 32) & 255,
    (timestamp >> 24) & 255,
    (timestamp >> 16) & 255,
    (timestamp >> 8) & 255,
    255 & timestamp,
  ]);

  const obfuscatedBytes = obfuscateBytes(byteArray);
  const encodedChecksum = Buffer.from(obfuscatedBytes).toString('base64');

  return `${encodedChecksum}${machineId}/${macMachineId}`;
}

// 简单的JPEG尺寸检测
function getJPEGDimensions(buffer) {
  try {
    let offset = 2; // 跳过SOI标记
    while (offset < buffer.length) {
      const marker = buffer.readUInt16BE(offset);
      offset += 2;
      
      if (marker >= 0xFFC0 && marker <= 0xFFC3) {
        // SOF (Start of Frame) 标记
        offset += 3; // 跳过长度和精度
        const height = buffer.readUInt16BE(offset);
        const width = buffer.readUInt16BE(offset + 2);
        return { width, height };
      }
      
      if (marker === 0xFFD9) break; // EOI标记
      
      const length = buffer.readUInt16BE(offset);
      offset += length;
    }
  } catch (error) {
    // 解析失败，返回默认值
  }
  return { width: 1024, height: 1024 };
}

// 简单的PNG尺寸检测
function getPNGDimensions(buffer) {
  try {
    // PNG文件的IHDR chunk在文件开头的固定位置
    if (buffer.length >= 24 && 
        buffer.readUInt32BE(0) === 0x89504E47 && // PNG签名
        buffer.readUInt32BE(4) === 0x0D0A1A0A) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
  } catch (error) {
    // 解析失败，返回默认值
  }
  return { width: 1024, height: 1024 };
}

module.exports = {
  generateCursorBody,
  chunkToUtf8String,
  generateHashed64Hex,
  generateCursorChecksum
};
