const readline = require('readline');
const util = require('util');
const path = require('path');
const fs = require('fs');
const writeFileAsync = util.promisify(fs.writeFile);
const parseArgs = require('minimist');
const glob = require('globby');
const cd = require('color-difference');
const chalk = require('chalk');


let { variables, directory, threshold } = parseArgs(
    process.argv.slice(2),
    {
        string: ['variables', 'directory', 'threshold'],
        alias: { V: 'variables', d: 'directory', t: 'threshold' },
        default: { threshold: 20 }
    }
);

threshold = parseInt(threshold, 10);

const varsFile = path.resolve(variables);

if (!directory) {
    directory = path.dirname(varsFile);
}
const stylesDirectory = path.resolve(directory);


const sassVarMatcher = /\$(.+?):\s*?(.+?);/g;

const hexMatcher = /(#[A-Fa-f0-9]{6}|#[A-Fa-f0-9]{3})/gi;


function promiseReadLine(file, onLine, onClose = () => undefined) {
    const rl = readline.createInterface({
        input: fs.createReadStream(file, 'utf8')
    });

    rl.on('line', onLine);

    return new Promise(
        (resolve, reject) => {
            rl.on('close', () => resolve(onClose()));
            rl.on('error', err => reject(err));
        }
    );
}

function extractStyleVarFromLine(line) {
    const [, key, value] = (sassVarMatcher.exec(line) || []);
    return { key, value };
}

function hexCodesOnLine(line) {
    const matcher = new RegExp(hexMatcher);
    const hexCodes = [];
    let matchedCode;

    while (matchedCode = matcher.exec(line)) {
        hexCodes.push(matchedCode[1]);
    }

    return hexCodes;
}


function extractStyleVariables() {
    const aliases = {}, roots = {};

    const onLine = line => {
        const { key, value } = extractStyleVarFromLine(line);
        if (key && value) {
            let varValue = value.trim();
            if (hexMatcher.test(varValue)) {
                return roots[key.trim()] = varValue;

            } else if (varValue.startsWith('$')) {
                varValue = varValue.substr(1);

                while (varValue) {
                    if (hexMatcher.test(roots[varValue])) {
                        return aliases[key.trim()] = varValue;
                    } else {
                        varValue = aliases[varValue];
                    }
                }

                console.warn('UNMATCHED', key.trim());
            }
        }
    };

    const onClose = () => Object.keys(roots)
                                .reduce((variablesByColor, variableName) => {
                                        const color = roots[variableName];
                                        variablesByColor[color] = variableName;
                                        return variablesByColor;
                                    },
                                    {}
                                );

    return promiseReadLine(varsFile, onLine, onClose);
}


function findStyleFiles() {
    return glob(
        [stylesDirectory, `!${varsFile}`],
        {
            absolute: true,
            onlyFiles: true,
            expandDirectories: { extensions: ['scss'] }
        }
    );
}

function isBrightish(hex) {
    return cd.compare(hex, '#000') >= 50;
}

function printHex(hexCode) {
    return chalk.keyword(isBrightish(hexCode) ? 'black' : 'white').bgHex(hexCode)(hexCode.padEnd(7));
}

function printDistance(distance) {
    const bad = distance > threshold;
    return chalk.keyword('white').bgKeyword(bad ? 'red' : 'green')(((bad ? '!' : '✔') + ' (' + distance.toFixed(2) + ')').padEnd(10));
}


async function run() {
    const variablesByColor = await extractStyleVariables()
        , colors = Object.keys(variablesByColor);

    const allStyleFiles = await findStyleFiles();

    for (const styleFile of allStyleFiles) {
        await processStyleFile(styleFile);
    }


    function findClosestColor(hexCode) {
        let closestDistance = Number.MAX_SAFE_INTEGER;

        const closestColor = colors.reduce(
            (closest, color) => {
                const distance = cd.compare(hexCode, color);

                if (distance < closestDistance) {
                    closestDistance = distance;
                    closest = color;
                }
                return closest;
            },
            ''
        );

        return { color: closestColor, distance: closestDistance };
    }

    function processStyleFile(file) {
        let output = '';

        const onLine = line => {
            const hexCodes = hexCodesOnLine(line);

            hexCodes.forEach(
                (hexCode) => {
                    const { color, distance } = findClosestColor(hexCode);

                    const variableName = variablesByColor[color];

                    if (distance <= threshold) {

                        console.log(
                            printDistance(distance),
                            printHex(hexCode),
                            ' ⇒ ',
                            printHex(color),
                            variableName,
                            file
                        );

                        line = line.replace(hexCode, ` $${variableName}`);
                    } else {
                        console.warn(
                            printDistance(distance),
                            printHex(hexCode),
                            ' ⇏ ',
                            printHex(color),
                            variableName,
                            file
                        );
                    }
                }
            );

            output += `${line}\n`;
        };

        const onClose = () => writeFileAsync(file, output, 'utf8');

        return promiseReadLine(file, onLine, onClose);
    }
}

run();
