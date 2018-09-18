const readline = require('readline');
const util = require('util');
const path = require('path');
const fs = require('fs');
const writeFileAsync = util.promisify(fs.writeFile);
const parseArgs = require('minimist');
const glob = require('globby');
const cd = require('color-difference');

let { variables, directory, threshold = 20 } = parseArgs(process.argv, opts = {});

const varsFile = path.resolve(variables);

if (!directory) {
    directory = path.dirname(varsFile);
}
const stylesDirectory = path.resolve(directory);


const sassVarMatcher = /\$(.+?):\s*?(.+?);/;

const hexMatcher = /(#[A-Fa-f0-9]{6}|#[A-Fa-f0-9]{3})/;


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

function hexCodeOfLine(line) {
    return (hexMatcher.exec(line) || [])[1];
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

    const onClose = () => ({ aliases, roots });

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


async function run() {
    const { roots: colorVariables } = await extractStyleVariables();

    const colors = [], variablesByColor = {};
    for (const variableName of Object.keys(colorVariables)) {
        let colorCode = colorVariables[variableName];
        colors.push(colorCode);
        variablesByColor[colorCode] = variableName;
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
            closestDistance
        );

        return { color: closestColor, distance: closestDistance };
    }


    const allStyleFiles = await findStyleFiles();

    for (const styleFile of allStyleFiles) {
        let output = '';

        const onLine = line => {
            const hexCode = hexCodeOfLine(line);
            if (hexCode) {
                const { color, distance } = findClosestColor(hexCode);

                const variableName = variablesByColor[color];

                if (distance <= threshold) {
                    line = line.replace(hexCode, `$${variableName}`);
                } else {
                    console.warn(hexCode, 'closest to', variableName, color, `(${distance})`);
                }
            }

            output += `${line}\n`;
        };

        const onClose = () => writeFileAsync(styleFile, output, 'utf8');

        await promiseReadLine(styleFile, onLine, onClose);
    }

}

run();
