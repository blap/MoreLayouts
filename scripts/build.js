const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// Configuration
const srcDir = path.join(__dirname, '..', 'src');
const outputDir = path.join(__dirname, '..', 'dist');
const extensionName = 'morelayouts-thunderbird';
const version = '7.3';
const xpiFile = path.join(outputDir, `${extensionName}-${version}.xpi`);

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Remove existing XPI file
if (fs.existsSync(xpiFile)) {
    fs.unlinkSync(xpiFile);
}

// Create a file to stream archive data to
const output = fs.createWriteStream(xpiFile);
const archive = archiver('zip', {
    zlib: { level: 9 } // Sets the compression level
});

// Listen for all archive data to be written
output.on('close', function() {
    console.log(`Build completed successfully!`);
    console.log(`Extension package created: ${xpiFile}`);
    console.log(`${archive.pointer()} total bytes`);
});

// Handle errors
archive.on('error', function(err) {
    throw err;
});

// Pipe archive data to the file
archive.pipe(output);

// Append files from src directory
archive.directory(srcDir, false);

// Finalize the archive
archive.finalize();