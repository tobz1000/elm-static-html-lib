function importLine(fullFunctionName: string): string {
    return "import " + fullFunctionName.substr(0, fullFunctionName.lastIndexOf("."));
}

function functionName(functionLine: string): string {
    return functionLine.substr(functionLine.lastIndexOf("."));
}

const decode = `
decode : FormatOptions -> Html msg -> String
decode options view =
    case Json.decodeValue (decodeElmHtml (\\_ \_ -> Json.succeed ())) (asJsonView view) of
        Err err -> "ERROR:" ++ Json.errorToString err
        Ok str -> nodeToStringWithOptions options str
            `;

function generateOptionsSet(newLines: boolean, indent: number): string {
    let newLinesStr;
    if (newLines === undefined || newLines === true) {
      newLinesStr = "True";
    } else {
      newLinesStr = "False";
    }

    const indentStr = indent !== undefined ? indent : 4;

    return `options = { defaultFormatOptions | newLines = ${newLinesStr}, indent = ${indentStr} }`;
}

export interface ViewFunctionConfig {
    viewFunction: string;
    viewHash: string;
    model?: any;
    decoder?: string;
    indent?: number;
    newLines?: boolean;
}

function renderCommandWithDecoder(viewHash: string, viewFunction: string, decoderName: string, optionsSet: string) {
    return `
render${viewHash} : Json.Value -> String
render${viewHash} values =
    let
        ${optionsSet}
    in
        case Json.decodeValue ${decoderName} values of
            Err err ->
                "I could not decode the argument for ${viewFunction}:" ++ Json.errorToString err

            Ok model ->
                (decode options) <| ${viewFunction} model
        `;
        }

function renderCommandWithoutDecoder(viewHash: string, viewFunction: string, optionsSet: string) {
    return `
render${viewHash} : Json.Value -> String
render${viewHash} _ =
    let
        ${optionsSet}
    in
        (decode options) <| ${viewFunction}
        `;
}

function generateBody(config: ViewFunctionConfig): string {
    const optionsSet = generateOptionsSet(config.newLines, config.indent);
    if (config.decoder) {
        return renderCommandWithDecoder(config.viewHash, config.viewFunction, config.decoder, optionsSet);
    } else {
        return renderCommandWithoutDecoder(config.viewHash, config.viewFunction, optionsSet);
    }
}

function uniqueBy(toKey: (x: any) => any, array: any[]): any[] {
    const keys = array.map(toKey);

    return array.filter((elem, pos, arr) => {
        return keys.indexOf(toKey(elem)) === pos;
    });
}

export function generateRendererFile(hash: string, configs: ViewFunctionConfig[]): string {
    const viewImports =
        configs
            .map((config) => importLine(config.viewFunction))
            .join("\n");

    const decoderImports =
        configs
            .map((config) => (config.decoder) ? importLine(config.decoder) + "\n" : "")
            .join("");

    const imports = viewImports + "\n" + decoderImports;

    const configsWithUniqueView = uniqueBy((x) => x.viewHash, configs);

    const renderCommands =
        configsWithUniqueView
            .map(generateBody)
            .join("\n\n");

    const renderersList =
        configs
        .map((config) => `render${config.viewHash}`)
            .join(", ");

    const port = `port htmlOut${hash} : List { generatedHtml : String, fileOutputName: String } -> Cmd msg`;

    return `
port module PrivateMain${hash} exposing (..)

import Platform
import Html exposing (Html)
import ElmHtml.InternalTypes exposing (decodeElmHtml)
import ElmHtml.ToString exposing (FormatOptions, nodeToStringWithOptions, defaultFormatOptions)
import Json.Decode as Json
import Json.Encode as JE

${imports}

${decode}

${renderCommands}

renderers : List (Json.Value -> String)
renderers = [ ${renderersList} ]

init : List (String, Json.Value) -> ((), Cmd msg)
init models =
    let
        mapper renderer (fileOutputName, model) =
            { generatedHtml = renderer model
            , fileOutputName = fileOutputName
            }

        command =
            List.map2 mapper renderers models
                |> htmlOut${hash}
    in
        ( (), command )


asJsonView : Html msg -> Json.Value
asJsonView x = JE.string "REPLACE_ME_WITH_JSON_STRINGIFY"

${port}

main = Platform.worker
    { init = init
    , update = (\\_ b -> (b, Cmd.none))
    , subscriptions = (\\_ -> Sub.none)
    }
    `;
}
