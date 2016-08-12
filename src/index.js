

/**
 * App ID for the skill
 */
var APP_ID = 'amzn1.ask.skill.d8597c5c-8047-4b0b-96a9-febff39619fc';//'amzn1.echo-sdk-ams.app.004d2cbb-da38-4f49-8800-0a36fe72d506';//replace with 'amzn1.echo-sdk-ams.app.[your-unique-value-here]';

var http = require('http'),
    alexaDateUtil = require('./alexaDateUtil');
const influx = require('influx');
const clientMonitor = influx({
  host : 'influx-qa-read.kdc.capitalone.com',
  port : 8086,
  protocol : 'http',
  username : 'infwriter',
  password : '-',
  database : 'splunk_alerts'
});

var currentProgression = [];
var chordsInABox = ["C", "C sharp", "D", "E flat", "E", "F", "F#", "G", "A flat", "A", "B flat", "B"];

/**
 * The AlexaSkill prototype and helper functions
 */
var AlexaSkill = require('./AlexaSkill');

/**
 * TidePooler is a child of AlexaSkill.
 * To read more about inheritance in JavaScript, see the link below.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Introduction_to_Object-Oriented_JavaScript#Inheritance
 */
var TidePooler = function () {
    AlexaSkill.call(this, APP_ID);
};

// Extend AlexaSkill
TidePooler.prototype = Object.create(AlexaSkill.prototype);
TidePooler.prototype.constructor = TidePooler;

// ----------------------- Override AlexaSkill request and intent handlers -----------------------

TidePooler.prototype.eventHandlers.onSessionStarted = function (sessionStartedRequest, session) {
    console.log("onSessionStarted requestId: " + sessionStartedRequest.requestId
        + ", sessionId: " + session.sessionId);
    // any initialization logic goes here
};

TidePooler.prototype.eventHandlers.onLaunch = function (launchRequest, session, response) {
    console.log("onLaunch requestId: " + launchRequest.requestId + ", sessionId: " + session.sessionId);
    handleWelcomeRequest(response);
};

TidePooler.prototype.eventHandlers.onSessionEnded = function (sessionEndedRequest, session) {
    console.log("onSessionEnded requestId: " + sessionEndedRequest.requestId
        + ", sessionId: " + session.sessionId);
    // any cleanup logic goes here
};

/**
 * override intentHandlers to map intent handling functions.
 */
TidePooler.prototype.intentHandlers = {
    "OneshotTideIntent": function (intent, session, response) {
        handleOneshotTideRequest(intent, session, response);
    },

    "OneshotAnomalyIntent": function (intent, session, response) {
        handleOneshotAnomalyRequest(intent, session, response);
    },

    "FirstChordIntent": function(intent, session, response)  {
        handleFirstChordRequest(intent, session, response);
    },

    "NextChordIntent": function (intent, session, response) {
        handleNextChordRequest(intent, session, response);
    },

    "DialogTideIntent": function (intent, session, response) {
        // Determine if this turn is for city, for date, or an error.
        // We could be passed slots with values, no slots, slots with no value.
        var citySlot = intent.slots.City;
        var dateSlot = intent.slots.Date;
        if (citySlot && citySlot.value) {
            handleCityDialogRequest(intent, session, response);
        } else if (dateSlot && dateSlot.value) {
            handleDateDialogRequest(intent, session, response);
        } else {
            handleNoSlotDialogRequest(intent, session, response);
        }
    },

    "SupportedCTASIntent": function (intent, session, response) {
        handleSupportedCTARequest(intent, session, response);
    },

    "AMAZON.HelpIntent": function (intent, session, response) {
        handleHelpRequest(response);
    },

    "AMAZON.StopIntent": function (intent, session, response) {
        var speechOutput = "Goodbye";
        response.tell(speechOutput);
    },

    "AMAZON.CancelIntent": function (intent, session, response) {
        var speechOutput = "Goodbye";
        response.tell(speechOutput);
    }
};

// -------------------------- TidePooler Domain Specific Business Logic --------------------------

// example city to NOAA station mapping. Can be found on: http://tidesandcurrents.noaa.gov/map/
var STATIONS = {
    'seattle': 9447130,
    'san francisco': 9414290,
    'monterey': 9413450,
    'los angeles': 9410660,
    'san diego': 9410170,
    'boston': 8443970,
    'new york': 8518750,
    'virginia beach': 8638863,
    'wilmington': 8658163,
    'charleston': 8665530,
    'beaufort': 8656483,
    'myrtle beach': 8661070,
    'miami': 8723214,
    'tampa': 8726667,
    'new orleans': 8761927,
    'galveston': 8771341
};

var CTATIONS = {
  'Logins': 1234,
  'View Rewards': 1235,
  'Make Payments': 1236,
};

function handleWelcomeRequest(response) {
    var whichCityPrompt = "Which Criticial Transaction would you like forecast information for?",
        speechOutput = {
            speech: "<speak>Welcome to Capital One Enterprise Monitoring Forecaster. "
                + "<audio src='https://s3.amazonaws.com/ask-storage/tidePooler/OceanWaves.mp3'/>"
                + whichCityPrompt
                + "</speak>",
            type: AlexaSkill.speechOutputType.SSML
        },
        repromptOutput = {
            speech: "I can lead you through providing a critical transaction and "
                + "tell you the forecast or how many anomalies have been detected in the past 30 hours, "
                + "or you can simply open the Forecaster Tool and ask a question like, "
                + "get forecast information for Make Payments."
                + "For a list of supported critical transaction, ask what critical transactions are supported. "
                + whichCityPrompt,
            type: AlexaSkill.speechOutputType.PLAIN_TEXT
        };

    response.ask(speechOutput, repromptOutput);
}

function handleHelpRequest(response) {
    var repromptText = "Which critical transaction would you like forecast information for?";
    var speechOutput = "I can lead you through providing a critical transaction and "
        + "tell you the forecast or how many anomalies have been detected in the past 30 hours, "
        + "or you can simply open the Forecaster Tool and ask a question like, "
        + "get forecast information for Make Payments."
        + "For a list of supported critical transaction, ask what critical transactions are supported. "
        + "Or you can say exit. "
        + repromptText;

    response.ask(speechOutput, repromptText);
}

/**
 * Handles the case where the user asked or for, or is otherwise being with supported forecasts
 */
function handleSupportedCTARequest(intent, session, response) {
    // get city re-prompt
    var repromptText = "Which Critical Transaction would you like forecast information for?";
    var speechOutput = "Currently, I know forecast information for these critical transactions: "
    + getAllCTASText()
    //+ getAllStationsText()
        + repromptText;

    response.ask(speechOutput, repromptText);
}

/**
 * Handles the dialog step where the user provides a city
 */
function handleCityDialogRequest(intent, session, response) {

    var cityStation = getCityStationFromIntent(intent, false),
        repromptText,
        speechOutput;
    if (cityStation.error) {
        repromptText = "Currently, I know tide information for these critical transactions: " + getAllStationsText()
            + "Which critical transactions would you like the forecast for?";
        // if we received a value for the incorrect city, repeat it to the user, otherwise we received an empty slot
        speechOutput = cityStation.city ? "I'm sorry, I don't have any data for " + cityStation.city + ". " + repromptText : repromptText;
        response.ask(speechOutput, repromptText);
        return;
    }

    // if we don't have a date yet, go to date. If we have a date, we perform the final request
    if (session.attributes.date) {
        getFinalTideResponse(cityStation, session.attributes.date, response);
    } else {
        // set city in session and prompt for date
        session.attributes.city = cityStation;
        speechOutput = "For which date?";
        repromptText = "For which date would you like the forecast for " + cityStation.city + "?";

        response.ask(speechOutput, repromptText);
    }
}

/**
 * Handles the dialog step where the user provides a date
 */
function handleDateDialogRequest(intent, session, response) {

    var date = getDateFromIntent(intent),
        repromptText,
        speechOutput;
    if (!date) {
        repromptText = "Please try again saying a day of the week, for example, Saturday. "
            + "For which date would you like CTA forecast information?";
        speechOutput = "I'm sorry, I didn't understand that date. " + repromptText;

        response.ask(speechOutput, repromptText);
        return;
    }

    // if we don't have a city yet, go to city. If we have a city, we perform the final request
    if (session.attributes.city) {
        getFinalTideResponse(session.attributes.city, date, response);
    } else {
        // The user provided a date out of turn. Set date in session and prompt for city
        session.attributes.date = date;
        speechOutput = "For which Critical Transaction would you like forecast information for " + date.displayDate + "?";
        repromptText = "For which Critical Transaction?";

        response.ask(speechOutput, repromptText);
    }
}

/**
 * Handle no slots, or slot(s) with no values.
 * In the case of a dialog based skill with multiple slots,
 * when passed a slot with no value, we cannot have confidence
 * it is the correct slot type so we rely on session state to
 * determine the next turn in the dialog, and reprompt.
 */
function handleNoSlotDialogRequest(intent, session, response) {
    if (session.attributes.city) {
        // get date re-prompt
        var repromptText = "Please try again saying a day of the week, for example, Saturday. ";
        var speechOutput = repromptText;

        response.ask(speechOutput, repromptText);
    } else {
        // get city re-prompt
        handleSupportedCitiesRequest(intent, session, response);
    }
}
function handleFirstChordRequest(intent, session, response) {
  //var speechOutput;
  if (currentProgression.length != 0) {
    response.tellWithCard("Are you sure you want to " +
    "delete your current progression " +
    "and start a new one?", "firstChordPossibleNew", speechOutput);
    //handleStartAgainRequest(intent, session, response);
  }
  var chordsInABox = ["C", "C sharp", "D", "E flat", "E", "F", "F#", "G", "A flat", "A", "B flat", "B"];
  var mathER = Math.random() * 12;
  var chordToChose = parseInt(mathER, 10);
  var chordWeChose = chordsInABox[chordToChose];
  var speechOutput = "Your first chord should be";
  if (chordToChose === 7 || chordToChose === 8 || chordToChose === 3 || chordToChose === 4) {
    speechOutput = speechOutput + " an ";
  } else {
    speechOutput = speechOutput + " a ";
  }
  speechOutput = speechOutput + chordWeChose;
  /*results1[0][0].numResults + " anomalies in the"*/
  //+ " past 30 hours.";
  currentProgression.push(chordWeChose);
  response.tellWithCard(speechOutput, "firstChord", speechOutput);
  return;
}
function handleNextChordRequest(intent, session, response) {
  if (currentProgression.length != 0 ) {
    response.tellWithCard("I would love to give you a next chord, " +
    "but I don't have any info such as your first chord or what key " +
    "the song is in!" + " At this point, you can either supply a key, " +
    "or I can supply a key for a song.");
  } else {
    var key = currentProgression[0];
    var lastChord = currentProgression[currentProgression.length - 1];
    var nextChord = getNextChord(key, lastChord);

  }
}

function getNextChord(key, lastChord) {
  var options = ["major one", "minor two", "minor three", "major four", "major five", "minor six", "diminished seven"];
  if (key == lastChord) {
    var steps = [0, 2, 4, 5, 7, 9, 11];
    var mathER = Math.random() * 6;
    var magicNumber = parseInt(mathER, 10);
    var thisOption = options[magicNumber];
    var thisSteps = steps[magicNumber];
    var lastChordPosition = 0;
    int j = 0;
    var breaker = true;
    //find position value 'j'
    //if CIAB[j] = current
    while (breaker) {
      if (chordsInABox[j] === currentProgression[currentProgression.length - 1]) {
        breaker = false;
      }
      if (j > 11) {
        j = 0;
      } else {
        j++;
      }
    }
    lastChordPosition = j;
    var stepsPlusPos = lastChordPosition + thisSteps;
    if (stepsPlusPos > 11) {
      stepsPlusPos = stepsPlusPos - 12;
    }
    return chordsInABox[stepsPlusPos];
    /*for (int j = 0; j < chordsInABox; j++) {

    }*/
  } else {
    //Find relationship between this Chord & key
    //Find J value (index of Chord)
    var breaker = true
    int j = 0;
    while (breaker) {
      if (chordsInABox[j] === currentProgression[currentProgression.length - 1]) {
        breaker = false;
      }
      if (j > 11) {
        j = 0;
      } else {
        j++;
      }
    }
    int i = 0;
    while (breaker) {
      if (chordsInABox[i] === currentProgression[0]) {
        breaker = false;
      }
      if (i > 11) {
        i = 0;
      } else {
        i++;
      }
    }
  }
}
/**
 * This handles the one-shot interaction, where the user utters a phrase like:
 * 'Alexa, open Tide Pooler and get tide information for Seattle on Saturday'.
 * If there is an error in a slot, this will guide the user to the dialog approach.
 */
function handleOneshotTideRequest(intent, session, response) {

    // Determine city, using default if none provided
    var cityStation = getCityStationFromIntent(intent, true),
        repromptText,
        speechOutput;
    if (cityStation.error) {
        // invalid city. move to the dialog
        repromptText = "Currently, I know the three hour forecast for these Critical Transactions: " + getAllStationsText()
            + "Which city would you like tide information for?";
        // if we received a value for the incorrect city, repeat it to the user, otherwise we received an empty slot
        speechOutput = cityStation.city ? "I'm sorry, I don't have any data for " + cityStation.city + ". " + repromptText : repromptText;

        response.ask(speechOutput, repromptText);
        return;
    }

    // Determine custom date
    var date = getDateFromIntent(intent);
    if (!date) {
        // Invalid date. set city in session and prompt for date
        session.attributes.city = cityStation;
        repromptText = "Please try again saying a day of the week, for example, Saturday. "
            + "For which date would you like forecast information?";
        speechOutput = "I'm sorry, I didn't understand that date. " + repromptText;

        response.ask(speechOutput, repromptText);
        return;
    }

    // all slots filled, either from the user or by default values. Move to final request
    getFinalTideResponse(cityStation, date, response);
}

function handleOneshotAnomalyRequest(intent, session, response) {

    // Determine city, using default if none provided
    var cityStation = getCityStationFromIntent(intent, true),
        repromptText,
        speechOutput;
    if (cityStation.error) {
        // invalid city. move to the dialog
        repromptText = "Currently, I know the three hour forecast for these Critical Transactions: " + getAllStationsText()
            + "Which CTA would you like forecast information for?";
        // if we received a value for the incorrect city, repeat it to the user, otherwise we received an empty slot
        speechOutput = cityStation.city ? "I'm sorry, I don't have any data for " + cityStation.city + ". " + repromptText : repromptText;

        response.ask(speechOutput, repromptText);
        return;
    }

    // Determine custom date
    var date = getDateFromIntent(intent);
    if (!date) {
        // Invalid date. set city in session and prompt for date
        session.attributes.city = cityStation;
        repromptText = "Please try again saying a day of the week, for example, Saturday. "
            + "For which date would you like forecast information?";
        speechOutput = "I'm sorry, I didn't understand that date. " + repromptText;

        response.ask(speechOutput, repromptText);
        return;
    }

    // all slots filled, either from the user or by default values. Move to final request
    getFinalAnomalyResponse(cityStation, date, response);
}

function getFinalAnomalyResponse(cityStation, date, response) {
  debugger;
  var realQuery = 'SELECT CTA, numResults, url FROM "splunk_alerts"."default"."LoginAnomalies4" ORDER BY time DESC LIMIT 10';

  clientMonitor.query(realQuery, function (err, results1) {
    if (err) {
        speechOutput = "Sorry, influxDB, splunk, AWS or Capacitor is experiencing a problem. Please try again later";
    } else {
    speechOutput = "There have been " + results1[0][0].numResults + " anomalies in the"
    + " past 30 hours.";
    response.tellWithCard(speechOutput, "AnomalyResult", speechOutput);
  }
  });
}
  /*  // Issue the request, and respond to the user
    makeAnomalyRequest(cityStation.station, date, function tideResponseCallback(err, highTideResponse) {
        var speechOutput;

        if (err) {
            speechOutput = "Sorry, influxDB, splunk, AWS or Capacitor is experiencing a problem. Please try again later";
        } else {
          //put the query here.


                /*anomalies: results1[0][0].numResults,
                url: results1[0][0].url,
                time: results1[0][0].time,
                cta: results1[0][0].CTA,*/
          //});

            /*date.displayDate + " in " + cityStation.city + ", the first high tide will be around "
                + highTideResponse.firstHighTideTime + ", and will peak at about " + highTideResponse.firstHighTideHeight
                + ", followed by a low tide at around " + highTideResponse.lowTideTime
                + " that will be about " + highTideResponse.lowTideHeight
                + ". The second high tide will be around " + highTideResponse.secondHighTideTime
                + ", and will peak at about " + highTideResponse.secondHighTideHeight + ".";*/
        //}

        //response.tellWithCard(speechOutput, "AnomalyResult", speechOutput)
    //});
//}

/**
 * Both the one-shot and dialog based paths lead to this method to issue the request, and
 * respond to the user with the final answer.
 */
function getFinalTideResponse(cityStation, date, response) {

    // Issue the request, and respond to the user
    makeTideRequest(cityStation.station, date, function tideResponseCallback(err, highTideResponse) {
        var speechOutput;

        if (err) {
            speechOutput = "Sorry, influxDB, splunk, AWS or Kapacitor is experiencing a problem. Please try again later";
        } else {
            speechOutput = date.displayDate + " in " + cityStation.city + ", the first high tide will be around "
                + highTideResponse.firstHighTideTime + ", and will peak at about " + highTideResponse.firstHighTideHeight
                + ", followed by a low tide at around " + highTideResponse.lowTideTime
                + " that will be about " + highTideResponse.lowTideHeight
                + ". The second high tide will be around " + highTideResponse.secondHighTideTime
                + ", and will peak at about " + highTideResponse.secondHighTideHeight + ".";
        }

        response.tellWithCard(speechOutput, "TidePooler", speechOutput)
    });
}

/**
 * Uses NOAA.gov API, documented: http://tidesandcurrents.noaa.gov/api/
 * Results can be verified at: http://tidesandcurrents.noaa.gov/noaatidepredictions/NOAATidesFacade.jsp?Stationid=[id]
 */
function makeTideRequest(station, date, tideResponseCallback) {

    var datum = "MLLW";
    var endpoint = 'http://tidesandcurrents.noaa.gov/api/datagetter';
    var queryString = '?' + date.requestDateParam;
    queryString += '&station=' + station;
    queryString += '&product=predictions&datum=' + datum + '&units=english&time_zone=lst_ldt&format=json';

    http.get(endpoint + queryString, function (res) {
        var noaaResponseString = '';
        console.log('Status Code: ' + res.statusCode);

        if (res.statusCode != 200) {
            tideResponseCallback(new Error("Non 200 Response"));
        }

        res.on('data', function (data) {
            noaaResponseString += data;
        });

        res.on('end', function () {
            var noaaResponseObject = JSON.parse(noaaResponseString);

            if (noaaResponseObject.error) {
                console.log("NOAA error: " + noaaResponseObj.error.message);
                tideResponseCallback(new Error(noaaResponseObj.error.message));
            } else {
                var highTide = findHighTide(noaaResponseObject);
                tideResponseCallback(null, highTide);
            }
        });
    }).on('error', function (e) {
        console.log("Communications error: " + e.message);
        tideResponseCallback(new Error(e.message));
    });
}

function makeAnomalyRequest(station, date, tideResponseCallback) {

    var datum = "MLLW";
    var endpoint = 'http://tidesandcurrents.noaa.gov/api/datagetter';
    var queryString = '?' + date.requestDateParam;
    queryString += '&station=' + station;
    queryString += '&product=predictions&datum=' + datum + '&units=english&time_zone=lst_ldt&format=json';
    var realQuery = 'SELECT CTA, numResults, url FROM "splunk_alerts"."default"."LoginAnomalies4" ORDER BY time DESC LIMIT 10';

      //results1[0][0].numResults
      /*
      time	CTA	numResults	url*/
      var highTide = findNom();
      tideResponseCallback(null, highTide);

    http.get(endpoint + queryString, function (res) {
        var noaaResponseString = '';
        console.log('Status Code: ' + res.statusCode);

        if (res.statusCode != 200) {
            tideResponseCallback(new Error("Non 200 Response"));
        }

        res.on('data', function (data) {
            noaaResponseString += data;
        });

        res.on('end', function () {
            var noaaResponseObject = JSON.parse(noaaResponseString);

            if (noaaResponseObject.error) {
                console.log("NOAA error: " + noaaResponseObj.error.message);
                tideResponseCallback(new Error(noaaResponseObj.error.message));
            } else {
                var highTide = findHighTide(noaaResponseObject);
                tideResponseCallback(null, highTide);
            }
        });
    }).on('error', function (e) {
        console.log("Communications error: " + e.message);
        tideResponseCallback(new Error(e.message));
    });
}
function findNom() {
  var realQuery = 'SELECT CTA, numResults, url FROM "splunk_alerts"."default"."LoginAnomalies4" ORDER BY time DESC LIMIT 10';

  clientMonitor.query(realQuery, function (err, results1) {
    return {
        anomalies: results1[0][0].numResults,
        url: results1[0][0].url,
        time: results1[0][0].time,
        cta: results1[0][0].CTA,
    }
  });
}
/**
 * Algorithm to find the 2 high tides for the day, the first of which is smaller and occurs
 * mid-day, the second of which is larger and typically in the evening
 */
function findHighTide(noaaResponseObj) {
    var predictions = noaaResponseObj.predictions;
    var lastPrediction;
    var firstHighTide, secondHighTide, lowTide;
    var firstTideDone = false;

    for (var i = 0; i < predictions.length; i++) {
        var prediction = predictions[i];

        if (!lastPrediction) {
            lastPrediction = prediction;
            continue;
        }

        if (isTideIncreasing(lastPrediction, prediction)) {
            if (!firstTideDone) {
                firstHighTide = prediction;
            } else {
                secondHighTide = prediction;
            }

        } else { // we're decreasing

            if (!firstTideDone && firstHighTide) {
                firstTideDone = true;
            } else if (secondHighTide) {
                break; // we're decreasing after have found 2nd tide. We're done.
            }

            if (firstTideDone) {
                lowTide = prediction;
            }
        }

        lastPrediction = prediction;
    }

    return {
        firstHighTideTime: alexaDateUtil.getFormattedTime(new Date(firstHighTide.t)),
        firstHighTideHeight: getFormattedHeight(firstHighTide.v),
        lowTideTime: alexaDateUtil.getFormattedTime(new Date(lowTide.t)),
        lowTideHeight: getFormattedHeight(lowTide.v),
        secondHighTideTime: alexaDateUtil.getFormattedTime(new Date(secondHighTide.t)),
        secondHighTideHeight: getFormattedHeight(secondHighTide.v)
    }
}

function isTideIncreasing(lastPrediction, currentPrediction) {
    return parseFloat(lastPrediction.v) < parseFloat(currentPrediction.v);
}

/**
 * Formats the height, rounding to the nearest 1/2 foot. e.g.
 * 4.354 -> "four and a half feet".
 */
function getFormattedHeight(height) {
    var isNegative = false;
    if (height < 0) {
        height = Math.abs(height);
        isNegative = true;
    }

    var remainder = height % 1;
    var feet, remainderText;

    if (remainder < 0.25) {
        remainderText = '';
        feet = Math.floor(height);
    } else if (remainder < 0.75) {
        remainderText = " and a half";
        feet = Math.floor(height);
    } else {
        remainderText = '';
        feet = Math.ceil(height);
    }

    if (isNegative) {
        feet *= -1;
    }

    var formattedHeight = feet + remainderText + " feet";
    return formattedHeight;
}

/**
 * Gets the city from the intent, or returns an error
 */
function getCityStationFromIntent(intent, assignDefault) {

    var citySlot = intent.slots.City;
    // slots can be missing, or slots can be provided but with empty value.
    // must test for both.
    if (!citySlot || !citySlot.value) {
        if (!assignDefault) {
            return {
                error: true
            }
        } else {
            // For sample skill, default to Seattle.
            return {
                city: 'Login',
                station: STATIONS.seattle
            }
        }
    } else {
        // lookup the city. Sample skill uses well known mapping of a few known cities to station id.
        var cityName = citySlot.value;
        if (STATIONS[cityName.toLowerCase()]) {
            return {
                city: cityName,
                station: STATIONS[cityName.toLowerCase()]
            }
        } else {
            return {
                error: true,
                city: cityName
            }
        }
    }
}

/**
 * Gets the date from the intent, defaulting to today if none provided,
 * or returns an error
 */
function getDateFromIntent(intent) {

    var dateSlot = intent.slots.Date;
    // slots can be missing, or slots can be provided but with empty value.
    // must test for both.
    if (!dateSlot || !dateSlot.value) {
        // default to today
        return {
            displayDate: "Today",
            requestDateParam: "date=today"
        }
    } else {

        var date = new Date(dateSlot.value);

        // format the request date like YYYYMMDD
        var month = (date.getMonth() + 1);
        month = month < 10 ? '0' + month : month;
        var dayOfMonth = date.getDate();
        dayOfMonth = dayOfMonth < 10 ? '0' + dayOfMonth : dayOfMonth;
        var requestDay = "begin_date=" + date.getFullYear() + month + dayOfMonth
            + "&range=24";

        return {
            displayDate: alexaDateUtil.getFormattedDate(date),
            requestDateParam: requestDay
        }
    }
}

function getAllCTASText() {
    var stationList = '';
    for (var station in CTATIONS) {
        stationList += station + ", ";
    }
    return stationList;
}

function getAllStationsText() {
    var stationList = '';
    for (var station in STATIONS) {
        stationList += station + ", ";
    }

    return stationList;
}

// Create the handler that responds to the Alexa Request.
exports.handler = function (event, context) {
    var tidePooler = new TidePooler();
    tidePooler.execute(event, context);
};
