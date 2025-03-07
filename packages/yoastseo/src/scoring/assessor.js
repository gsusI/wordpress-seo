import MissingArgument from "../errors/missingArgument";
import removeDuplicateMarks from "../markers/removeDuplicateMarks";
import AssessmentResult from "../values/AssessmentResult.js";
import { showTrace } from "../helpers/errors.js";

import { __, sprintf } from "@wordpress/i18n";
import { filter, find, findIndex, isFunction, isUndefined, map } from "lodash";
import LanguageProcessor from "../parse/language/LanguageProcessor";
import { build } from "../parse/build";

// The maximum score of individual assessment is 9. This is why we set the "score rating" here to 9.
const ScoreRating = 9;

/**
 * Creates the Assessor.
 *
 * @param {Researcher} researcher   The researcher to use in the assessor.
 * @param {Object?} options         The options for this assessor.
 * @param {Function} options.marker The marker to pass the list of marks to.
 *
 * @constructor
 */
const Assessor = function( researcher, options ) {
	this.type = "assessor";
	this.setResearcher( researcher );
	this._assessments = [];

	this._options = options || {};
};

/**
 * Checks if the researcher is defined and sets it.
 *
 * @param   {Researcher} researcher The researcher to use in the assessor.
 *
 * @throws  {MissingArgument} Parameter needs to be a valid researcher object.
 * @returns {void}
 */
Assessor.prototype.setResearcher = function( researcher ) {
	if ( isUndefined( researcher ) ) {
		throw new MissingArgument( "The assessor requires a researcher." );
	}
	this._researcher = researcher;
};

/**
 * Gets all available assessments.
 * @returns {object} assessment
 */
Assessor.prototype.getAvailableAssessments = function() {
	return this._assessments;
};

/**
 * Checks whether the Assessment is applicable.
 *
 * @param {Object} assessment The Assessment object that needs to be checked.
 * @param {Paper} paper The Paper object to check against.
 * @param {Researcher} [researcher] The Researcher object containing additional information.
 * @returns {boolean} Whether or not the Assessment is applicable.
 */
Assessor.prototype.isApplicable = function( assessment, paper, researcher ) {
	if ( assessment.hasOwnProperty( "isApplicable" ) || typeof assessment.isApplicable === "function" ) {
		return assessment.isApplicable( paper, researcher );
	}

	return true;
};

/**
 * Determines whether an assessment has a marker.
 *
 * @param {Object} assessment The assessment to check for.
 * @returns {boolean} Whether or not the assessment has a marker.
 */
Assessor.prototype.hasMarker = function( assessment ) {
	return isFunction( this._options.marker ) && ( assessment.hasOwnProperty( "getMarks" ) || typeof assessment.getMarks === "function" );
};

/**
 * Returns the specific marker for this assessor.
 *
 * @returns {Function} The specific marker for this assessor.
 */
Assessor.prototype.getSpecificMarker = function() {
	return this._options.marker;
};

/**
 * Returns the paper that was most recently assessed.
 *
 * @returns {Paper} The paper that was most recently assessed.
 */
Assessor.prototype.getPaper = function() {
	return this._lastPaper;
};

/**
 * Returns the marker for a given assessment, composes the specific marker with the assessment getMarks function.
 *
 * @param {Object} assessment The assessment for which we are retrieving the composed marker.
 * @param {Paper} paper The paper to retrieve the marker for.
 * @param {Researcher} researcher The researcher for the paper.
 * @returns {Function} A function that can mark the given paper according to the given assessment.
 */
Assessor.prototype.getMarker = function( assessment, paper, researcher ) {
	const specificMarker = this._options.marker;

	return function() {
		let marks = assessment.getMarks( paper, researcher );
		marks = removeDuplicateMarks( marks );

		specificMarker( paper, marks );
	};
};

/**
 * Runs the researches defined in the task list or the default researches.
 *
 * @param {Paper} paper The paper to run assessments on.
 * @returns {void}
 */
Assessor.prototype.assess = function( paper ) {
	this._researcher.setPaper( paper );

	const languageProcessor = new LanguageProcessor( this._researcher );
	const shortcodes = paper._attributes && paper._attributes.shortcodes;
	paper.setTree( build( paper, languageProcessor, shortcodes ) );

	let assessments = this.getAvailableAssessments();
	this.results = [];

	assessments = filter( assessments, function( assessment ) {
		return this.isApplicable( assessment, paper, this._researcher );
	}.bind( this ) );

	this.setHasMarkers( false );
	this.results = map( assessments, this.executeAssessment.bind( this, paper, this._researcher ) );

	this._lastPaper = paper;
};

/**
 * Sets the value of has markers with a boolean to determine if there are markers.
 *
 * @param {boolean} hasMarkers True when there are markers, otherwise it is false.
 * @returns {void}
 */
Assessor.prototype.setHasMarkers = function( hasMarkers ) {
	this._hasMarkers = hasMarkers;
};

/**
 * Returns true when there are markers.
 *
 * @returns {boolean} Are there markers
 */
Assessor.prototype.hasMarkers = function() {
	return this._hasMarkers;
};

/**
 * Executes an assessment and returns the AssessmentResult.
 *
 * @param {Paper} paper The paper to pass to the assessment.
 * @param {Researcher} researcher The researcher to pass to the assessment.
 * @param {Object} assessment The assessment to execute.
 * @returns {AssessmentResult} The result of the assessment.
 */
Assessor.prototype.executeAssessment = function( paper, researcher, assessment ) {
	let result;

	try {
		result = assessment.getResult( paper, researcher );
		result.setIdentifier( assessment.identifier );

		if ( result.hasMarks() ) {
			result.marks = assessment.getMarks( paper, researcher );
			result.marks = removeDuplicateMarks( result.marks );
		}

		if ( result.hasMarks() && this.hasMarker( assessment ) ) {
			this.setHasMarkers( true );

			result.setMarker( this.getMarker( assessment, paper, researcher ) );
		}
	} catch ( assessmentError ) {
		showTrace( assessmentError );

		result = new AssessmentResult();

		result.setScore( -1 );
		result.setText( sprintf(
			/* translators: %1$s expands to the name of the assessment. */
			__( "An error occurred in the '%1$s' assessment", "wordpress-seo" ),
			assessment.identifier,
			assessmentError
		) );
	}
	return result;
};

/**
 * Filters out all assessment results that have no score and no text.
 *
 * @returns {Array<AssessmentResult>} The array with all the valid assessments.
 */
Assessor.prototype.getValidResults = function() {
	return filter( this.results, function( result ) {
		return this.isValidResult( result );
	}.bind( this ) );
};

/**
 * Returns if an assessmentResult is valid.
 *
 * @param {object} assessmentResult The assessmentResult to validate.
 * @returns {boolean} whether or not the result is valid.
 */
Assessor.prototype.isValidResult = function( assessmentResult ) {
	return assessmentResult.hasScore() && assessmentResult.hasText();
};

/**
 * Returns the overall score. Calculates the total score by adding all scores and dividing these
 * by the number of results times the ScoreRating.
 *
 * @returns {number} The overall score.
 */
Assessor.prototype.calculateOverallScore  = function() {
	const results = this.getValidResults();

	const totalScore = results.reduce( ( total, assessmentResult ) => total + assessmentResult.getScore(), 0 );

	return Math.round( totalScore / ( results.length * ScoreRating ) * 100 ) || 0;
};

/**
 * Register an assessment to add it to the internal assessments object.
 *
 * @param {string} name The name of the assessment.
 * @param {object} assessment The object containing function to run as an assessment and it's requirements.
 * @returns {boolean} Whether registering the assessment was successful.
 * @private
 */
Assessor.prototype.addAssessment = function( name, assessment ) {
	if ( ! assessment.hasOwnProperty( "identifier" ) ) {
		assessment.identifier = name;
	}
	// If the assessor already has the same assessment, remove it and replace it with the new assessment with the same identifier.
	if ( this.getAssessment( assessment.identifier ) ) {
		this.removeAssessment( assessment.identifier );
	}

	this._assessments.push( assessment );
	return true;
};

/**
 * Remove a specific Assessment from the list of Assessments.
 *
 * @param {string} name The Assessment to remove from the list of assessments.
 * @returns {void}
 */
Assessor.prototype.removeAssessment = function( name ) {
	const toDelete = findIndex( this._assessments, function( assessment ) {
		return assessment.hasOwnProperty( "identifier" ) && name === assessment.identifier;
	} );

	if ( -1 !== toDelete ) {
		this._assessments.splice( toDelete, 1 );
	}
};

/**
 * Returns an assessment by identifier
 *
 * @param {string} identifier The identifier of the assessment.
 * @returns {undefined|Assessment} The object if found, otherwise undefined.
 */
Assessor.prototype.getAssessment = function( identifier ) {
	return find( this._assessments, function( assessment ) {
		return assessment.hasOwnProperty( "identifier" ) && identifier === assessment.identifier;
	} );
};

/**
 * Checks which of the available assessments are applicable and returns an array with applicable assessments.
 *
 * @returns {Array} The array with applicable assessments.
 */
Assessor.prototype.getApplicableAssessments = function() {
	const availableAssessments = this.getAvailableAssessments();
	return filter(
		availableAssessments,
		function( availableAssessment ) {
			return this.isApplicable( availableAssessment, this.getPaper(), this._researcher );
		}.bind( this )
	);
};


export default Assessor;
